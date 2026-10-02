-- =====================================================================
-- Public search API (callable via supabase.rpc / PostgREST).
-- =====================================================================

-- ---------------------------------------------------------------------
-- autocomplete: runs on every keystroke. No embeddings — prefix
-- full-text match + trigram similarity, so "kurt", "rangr", "kutra" work.
-- ---------------------------------------------------------------------
create or replace function public.autocomplete(prefix text, limit_count integer default 8)
returns table (
  kind       text,     -- 'product' | 'brand' | 'category'
  label      text,
  sublabel   text,
  product_id bigint,
  slug       text,
  price      numeric,
  score      double precision
)
language sql stable security definer
set search_path = public, search, extensions
set pg_trgm.word_similarity_threshold = 0.5
as $$
  with q as (
    select t,
           (select to_tsquery('simple', string_agg(quote_literal(w) || ':*', ' & '))
              from regexp_split_to_table(t, '[^[:alnum:]]+') w
             where w <> '') as tsq
      from (select lower(btrim(coalesce(prefix, ''))) as t) x
  ),
  product_hits as (
    select 'product'::text as kind,
           ps.title as label,
           concat_ws(' · ', b.name, c.name) as sublabel,
           p.id as product_id,
           p.slug,
           p.price,
           ( case when lower(ps.title) like q.t || '%' then 2 else 0 end
           + case when ps.title_fts @@ q.tsq then 1 else 0 end
           + word_similarity(q.t, ps.title)
           + 0.05 * ln(1 + p.popularity) / ln(10001) )::double precision as score
      from search.product_search ps
      join products p on p.id = ps.product_id
      left join brands b on b.id = p.brand_id
      left join categories c on c.id = p.category_id
      cross join q
     where length(q.t) >= 2
       and (ps.title_fts @@ q.tsq
            or q.t <% ps.title
            or (q.t ~ '\d' and ps.keywords ilike '%' || q.t || '%'))   -- SKU / model number
     order by score desc
     limit limit_count
  ),
  brand_hits as (
    select 'brand'::text, b.name, count(p.id) || ' products', null::bigint, b.slug, null::numeric,
           (case when lower(b.name) like q.t || '%' then 2 else 0 end + word_similarity(q.t, b.name))::double precision as score
      from brands b
      join products p on p.brand_id = b.id and p.is_active
      cross join q
     where length(q.t) >= 2 and (lower(b.name) like q.t || '%' or q.t <% b.name)
     group by b.id, q.t
     order by score desc
     limit 2
  ),
  category_hits as (
    select 'category'::text, c.name, coalesce(pc.name, 'Category'), null::bigint, c.slug, null::numeric,
           (case when lower(c.name) like q.t || '%' then 2 else 0 end + word_similarity(q.t, c.name))::double precision as score
      from categories c
      left join categories pc on pc.id = c.parent_id
      cross join q
     where length(q.t) >= 2 and (lower(c.name) like q.t || '%' or q.t <% c.name)
     order by score desc
     limit 3
  )
  select * from brand_hits
  union all select * from category_hits
  union all select * from product_hits;
$$;

-- ---------------------------------------------------------------------
-- search_products: hybrid search with Reciprocal Rank Fusion.
--   keyword side  -> exact words, brand names, SKUs, typos (fts + trigram)
--   semantic side -> meaning ("comfortable shoes for long walks")
--   filters       -> plain SQL (price, color, gender, brand, size, stock)
-- query_embedding may be null (keyword-only); query_text may be empty
-- (filter-only browse, e.g. "red under 500").
--
-- Semantic cutoff is *relative*: gte-small squeezes similarities into a
-- narrow band (even gibberish scores ~0.8), so a fixed threshold can't
-- separate good from bad. We keep hits within semantic_window of the best.
-- ---------------------------------------------------------------------
create or replace function public.search_products(
  query_text      text default '',
  query_embedding extensions.vector(384) default null,
  filters         jsonb default '{}'::jsonb,
  match_count     integer default 24,
  keyword_weight  double precision default 1.0,
  semantic_weight double precision default 1.0,
  min_similarity  double precision default 0.70,
  semantic_window double precision default 0.05,
  rrf_k           integer default 50
)
returns table (
  id            bigint,
  name          text,
  slug          text,
  brand         text,
  category      text,
  gender        text,
  price         numeric,
  mrp           numeric,
  rating        numeric,
  image_url     text,
  colors        text[],
  in_stock      boolean,
  score         double precision,
  keyword_rank  integer,
  semantic_rank integer,
  similarity    double precision
)
language plpgsql stable security definer
set search_path = public, search, extensions
set pg_trgm.word_similarity_threshold = 0.45
as $$
#variable_conflict use_column
declare
  qt          text    := btrim(coalesce(query_text, ''));
  -- "any word" matching; ts_rank_cd still ranks docs matching more words higher
  tsq         tsquery := case when btrim(coalesce(query_text, '')) = '' then null
                              else nullif(replace(websearch_to_tsquery('english', query_text)::text, ' & ', ' | '), '')::tsquery end;
  f_price_min numeric := (filters ->> 'price_min')::numeric;
  f_price_max numeric := (filters ->> 'price_max')::numeric;
  f_in_stock  boolean := (filters ->> 'in_stock')::boolean;
  f_colors    text[]  := case when jsonb_typeof(filters -> 'colors') = 'array'
                              then array(select lower(jsonb_array_elements_text(filters -> 'colors'))) end;
  f_genders   text[]  := case when jsonb_typeof(filters -> 'genders') = 'array'
                              then array(select jsonb_array_elements_text(filters -> 'genders')) end;
  f_sizes     text[]  := case when jsonb_typeof(filters -> 'sizes') = 'array'
                              then array(select jsonb_array_elements_text(filters -> 'sizes')) end;
  f_brand_ids bigint[] := case when jsonb_typeof(filters -> 'brand_ids') = 'array'
                              then array(select (jsonb_array_elements_text(filters -> 'brand_ids'))::bigint) end;
  f_category_ids bigint[] := case when jsonb_typeof(filters -> 'category_ids') = 'array'
                              then array(select (jsonb_array_elements_text(filters -> 'category_ids'))::bigint) end;
  has_filters boolean;
  cand_ids    bigint[];
  pool        integer := greatest(match_count * 3, 60);
begin
  if cardinality(f_colors) = 0 then f_colors := null; end if;
  if cardinality(f_genders) = 0 then f_genders := null; end if;
  if cardinality(f_sizes) = 0 then f_sizes := null; end if;
  if cardinality(f_brand_ids) = 0 then f_brand_ids := null; end if;
  if cardinality(f_category_ids) = 0 then f_category_ids := null; end if;

  has_filters := coalesce(f_price_min, f_price_max) is not null
              or f_in_stock is true
              or f_colors is not null or f_genders is not null or f_sizes is not null
              or f_brand_ids is not null or f_category_ids is not null;

  -- Resolve hard filters to a candidate set first.
  if has_filters then
    select array_agg(p.id) into cand_ids
      from products p
     where p.is_active
       and (f_price_min is null or p.price >= f_price_min)
       and (f_price_max is null or p.price <= f_price_max)
       and (f_genders is null or p.gender = any (f_genders) or p.gender = 'unisex')
       and (f_brand_ids is null or p.brand_id = any (f_brand_ids))
       and (f_category_ids is null or p.category_id = any (f_category_ids)
            or p.category_id in (select c.id from categories c where c.parent_id = any (f_category_ids)))
       and (f_colors is null or exists (
              select 1 from product_variants v, unnest(f_colors) fc
               where v.product_id = p.id and lower(v.color) ~ ('\m' || search.re_escape(fc) || '\M')))
       and (f_sizes is null or exists (
              select 1 from product_variants v
               where v.product_id = p.id and v.size = any (f_sizes) and v.stock > 0))
       and (f_in_stock is not true or exists (
              select 1 from product_variants v where v.product_id = p.id and v.stock > 0));

    if cand_ids is null then
      return;
    end if;
  end if;

  return query
  with
  keyword as (
    select k.product_id, row_number() over (order by k.rank_score desc)::integer as rnk
      from (
        select ps.product_id,
               ts_rank_cd(ps.fts, tsq, 32) + 0.5 * word_similarity(qt, ps.title) as rank_score
          from search.product_search ps
         where tsq is not null
           and (not has_filters or ps.product_id = any (cand_ids))
           and (ps.fts @@ tsq or qt <% ps.title)
         order by rank_score desc
         limit pool
      ) k
  ),
  nearest as (
    -- No filters: let the HNSW index do the work.
    (select ps.product_id, ps.embedding <=> query_embedding as dist
       from search.product_search ps
      where query_embedding is not null and not has_filters
        and ps.embedding is not null
      order by ps.embedding <=> query_embedding
      limit pool)
    union all
    -- Filters: exact scan over the (small) candidate set. The "+ 0"
    -- stops the planner from using HNSW and post-filtering away hits.
    (select ps.product_id, ps.embedding <=> query_embedding as dist
       from search.product_search ps
      where query_embedding is not null and has_filters
        and ps.product_id = any (cand_ids)
        and ps.embedding is not null
      order by (ps.embedding <=> query_embedding) + 0
      limit pool)
  ),
  semantic as (
    select s.product_id, s.rnk, s.sim
      from (
        select n.product_id,
               row_number() over (order by n.dist)::integer as rnk,
               (1 - n.dist)::double precision as sim,
               max(1 - n.dist) over () as best
          from nearest n
      ) s
     where s.sim >= min_similarity
       and s.sim >= s.best - semantic_window
  ),
  browse as (
    -- No text at all (e.g. "red kurta under 500" fully parsed into filters
    -- leaves "kurta", but "red under 500" leaves nothing): rank by popularity.
    select p.id as product_id, row_number() over (order by p.popularity desc)::integer as rnk
      from products p
     where tsq is null and query_embedding is null
       and p.is_active
       and (not has_filters or p.id = any (cand_ids))
     order by p.popularity desc
     limit pool
  ),
  fused as (
    select coalesce(k.product_id, s.product_id, b.product_id) as product_id,
           coalesce(keyword_weight / (rrf_k + k.rnk), 0)
         + coalesce(semantic_weight / (rrf_k + s.rnk), 0)
         + coalesce(1.0 / (rrf_k + b.rnk), 0) as rrf,
           k.rnk as k_rank, s.rnk as s_rank, s.sim
      from keyword k
      full join semantic s on s.product_id = k.product_id
      full join browse b   on b.product_id = coalesce(k.product_id, s.product_id)
  )
  select p.id, p.name, p.slug, b.name, c.name, p.gender, p.price, p.mrp, p.rating, p.image_url,
         vs.colors,
         coalesce(vs.in_stock, false),
         -- business boosts: out-of-stock sinks, popular items float a little
         (f.rrf
           * case when coalesce(vs.in_stock, false) then 1.0 else 0.6 end
           * (1 + 0.15 * least(ln(1 + p.popularity) / ln(10001), 1)))::double precision,
         f.k_rank, f.s_rank, f.sim
    from fused f
    join products p on p.id = f.product_id
    left join brands b on b.id = p.brand_id
    left join categories c on c.id = p.category_id
    left join lateral (
      select bool_or(v.stock > 0) as in_stock,
             array_agg(distinct v.color) filter (where v.color is not null) as colors
        from product_variants v where v.product_id = p.id
    ) vs on true
   order by 13 desc
   limit match_count;
end;
$$;

revoke execute on function public.autocomplete(text, integer) from public;
revoke execute on function public.search_products(text, extensions.vector, jsonb, integer, double precision, double precision, double precision, double precision, integer) from public;
grant execute on function public.autocomplete(text, integer) to anon, authenticated, service_role;
grant execute on function public.search_products(text, extensions.vector, jsonb, integer, double precision, double precision, double precision, double precision, integer) to anon, authenticated, service_role;
