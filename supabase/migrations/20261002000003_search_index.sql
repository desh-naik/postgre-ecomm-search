-- =====================================================================
-- Search index: one "search document" + embedding per product.
-- Lives in its own schema so the store's tables stay untouched, and so
-- PostgREST does not expose it directly (only via public functions).
-- =====================================================================

create schema if not exists search;

create table search.product_search (
  product_id       bigint primary key references public.products (id) on delete cascade,
  title            text not null,                 -- product name (autocomplete + fuzzy)
  keywords         text not null default '',      -- brand, category, gender, colors, SKUs
  content          text not null,                 -- full document that gets embedded
  content_hash     text not null,                 -- md5(content)
  fts              tsvector generated always as (
                     setweight(to_tsvector('english', title), 'A') ||
                     setweight(to_tsvector('english', keywords), 'B') ||
                     setweight(to_tsvector('english', content), 'C')
                   ) stored,
  title_fts        tsvector generated always as (
                     to_tsvector('simple', title || ' ' || keywords)
                   ) stored,
  embedding        extensions.vector(384),        -- gte-small
  embedded_hash    text,                          -- content_hash the embedding was built from
  embed_claimed_at timestamptz,                   -- worker lease
  updated_at       timestamptz not null default now()
);

create index product_search_fts_idx       on search.product_search using gin (fts);
create index product_search_title_fts_idx on search.product_search using gin (title_fts);
create index product_search_title_trgm    on search.product_search using gin (title extensions.gin_trgm_ops);
create index product_search_keywords_trgm on search.product_search using gin (keywords extensions.gin_trgm_ops);  -- SKU lookup
create index product_search_embedding_idx on search.product_search using hnsw (embedding extensions.vector_cosine_ops);

-- The embedding "queue" is simply: rows whose embedding is stale.
-- No separate queue table to drift out of sync, and it works on any Postgres.
create index product_search_dirty_idx on search.product_search (updated_at)
  where embedded_hash is distinct from content_hash;

-- ---------------------------------------------------------------------
-- Build the text document for one product from all related tables.
-- Price and stock are deliberately excluded: they change often and are
-- filtered with plain SQL instead.
-- ---------------------------------------------------------------------
create or replace function search.build_document(p_id bigint)
returns table (title text, keywords text, content text)
language sql stable
set search_path = public, search
as $$
  select
    p.name,
    concat_ws(' ', b.name, pc.name, c.name, p.gender,
      (select string_agg(distinct v.color, ' ' order by v.color) from product_variants v where v.product_id = p.id),
      (select string_agg(v.sku, ' ' order by v.sku) from product_variants v where v.product_id = p.id)),
    concat_ws(E'\n',
      p.name,
      'Brand: ' || b.name,
      'Category: ' || concat_ws(' > ', pc.name, c.name),
      'For: ' || p.gender,
      'Colors: ' || (select string_agg(distinct v.color, ', ' order by v.color)
                       from product_variants v where v.product_id = p.id),
      (select string_agg(initcap(a.name) || ': ' || a.vals, E'\n' order by a.name)
         from (select pa.name, string_agg(pa.value, ', ' order by pa.value) as vals
                 from product_attributes pa where pa.product_id = p.id
                group by pa.name) a),
      p.description)
  from products p
  left join brands b      on b.id = p.brand_id
  left join categories c  on c.id = p.category_id
  left join categories pc on pc.id = c.parent_id
  where p.id = p_id;
$$;

-- ---------------------------------------------------------------------
-- Upsert one product's search row. A no-op unless something changed;
-- re-embedding only happens when content_hash changes (keywords such as
-- SKUs are keyword-search only and don't affect the embedding).
-- ---------------------------------------------------------------------
create or replace function search.refresh_product(p_id bigint)
returns void
language plpgsql security definer
set search_path = public, search
as $$
declare
  d record;
begin
  select * into d from search.build_document(p_id);

  if d.content is null or not exists (select 1 from products where id = p_id and is_active) then
    delete from search.product_search where product_id = p_id;
    return;
  end if;

  insert into search.product_search as ps (product_id, title, keywords, content, content_hash)
  values (p_id, d.title, d.keywords, d.content, md5(d.content))
  on conflict (product_id) do update
     set title        = excluded.title,
         keywords     = excluded.keywords,
         content      = excluded.content,
         content_hash = excluded.content_hash,
         updated_at   = now()
   where (ps.content_hash, ps.title, ps.keywords)
         is distinct from (excluded.content_hash, excluded.title, excluded.keywords);
end;
$$;

create or replace function search.refresh_all()
returns integer
language plpgsql security definer
set search_path = public, search
as $$
declare
  n integer := 0;
  r record;
begin
  for r in select id from products loop
    perform search.refresh_product(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- Sync triggers on the store's tables.
-- ---------------------------------------------------------------------
create or replace function search.on_product_change()
returns trigger
language plpgsql security definer
set search_path = public, search
as $$
begin
  -- DELETE is handled by the FK's ON DELETE CASCADE.
  perform search.refresh_product(new.id);
  return null;
end;
$$;

create or replace function search.on_product_child_change()
returns trigger
language plpgsql security definer
set search_path = public, search
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform search.refresh_product(old.product_id);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.product_id <> old.product_id) then
    perform search.refresh_product(new.product_id);
  end if;
  return null;
end;
$$;

create or replace function search.on_brand_change()
returns trigger
language plpgsql security definer
set search_path = public, search
as $$
begin
  perform search.refresh_product(p.id) from products p where p.brand_id = new.id;
  return null;
end;
$$;

create or replace function search.on_category_change()
returns trigger
language plpgsql security definer
set search_path = public, search
as $$
begin
  perform search.refresh_product(p.id)
     from products p
    where p.category_id = new.id
       or p.category_id in (select c.id from categories c where c.parent_id = new.id);
  return null;
end;
$$;

create trigger search_sync after insert or update on public.products
  for each row execute function search.on_product_change();

create trigger search_sync after insert or update or delete on public.product_variants
  for each row execute function search.on_product_child_change();

create trigger search_sync after insert or update or delete on public.product_attributes
  for each row execute function search.on_product_child_change();

create trigger search_sync after update of name on public.brands
  for each row execute function search.on_brand_change();

create trigger search_sync after update of name, parent_id on public.categories
  for each row execute function search.on_category_change();

-- Nothing in the search schema is reachable from the API except through
-- the public functions defined in later migrations.
revoke all on schema search from anon, authenticated;
