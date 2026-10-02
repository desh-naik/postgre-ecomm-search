-- =====================================================================
-- Rule-based query understanding (no LLM).
--   "laal cotton kurta under 1.5k for ladies"
--   -> filters {price_max: 1500, colors: [red], genders: [women]}
--   -> text    "cotton kurta"            (goes to keyword + vector search)
-- =====================================================================

-- Store-editable dictionary. kind:
--   color   -> adds a color filter      (laal -> red)
--   gender  -> adds a gender filter     (ladies -> women)
--   rewrite -> replaces the term in the text sent to search (shaadi -> wedding).
--              Useful because gte-small only understands English.
create table search.synonyms (
  term  text primary key,
  kind  text not null check (kind in ('color', 'gender', 'rewrite')),
  value text not null
);

insert into search.synonyms (term, kind, value) values
  -- gender
  ('men', 'gender', 'men'), ('mens', 'gender', 'men'), ('man', 'gender', 'men'),
  ('male', 'gender', 'men'), ('gents', 'gender', 'men'), ('gent', 'gender', 'men'),
  ('purush', 'gender', 'men'), ('mard', 'gender', 'men'),
  ('women', 'gender', 'women'), ('womens', 'gender', 'women'), ('woman', 'gender', 'women'),
  ('female', 'gender', 'women'), ('ladies', 'gender', 'women'), ('lady', 'gender', 'women'),
  ('mahila', 'gender', 'women'), ('aurat', 'gender', 'women'), ('aurton', 'gender', 'women'),
  ('kids', 'gender', 'kids'), ('kid', 'gender', 'kids'), ('children', 'gender', 'kids'),
  ('child', 'gender', 'kids'), ('baccha', 'gender', 'kids'), ('bachcha', 'gender', 'kids'),
  ('bacche', 'gender', 'kids'), ('bachche', 'gender', 'kids'), ('bacchon', 'gender', 'kids'),
  ('bachon', 'gender', 'kids'), ('bachchon', 'gender', 'kids'), ('baccho', 'gender', 'kids'),
  -- Hinglish colors
  ('laal', 'color', 'red'), ('lal', 'color', 'red'),
  ('kaala', 'color', 'black'), ('kala', 'color', 'black'), ('kaali', 'color', 'black'), ('kali', 'color', 'black'),
  ('safed', 'color', 'white'), ('safaid', 'color', 'white'),
  ('neela', 'color', 'blue'), ('nila', 'color', 'blue'), ('neeli', 'color', 'blue'),
  ('hara', 'color', 'green'), ('hari', 'color', 'green'),
  ('peela', 'color', 'yellow'), ('pila', 'color', 'yellow'), ('peeli', 'color', 'yellow'),
  ('gulabi', 'color', 'pink'),
  ('narangi', 'color', 'orange'), ('kesariya', 'color', 'orange'),
  ('baingani', 'color', 'purple'), ('jamuni', 'color', 'purple'),
  ('bhura', 'color', 'brown'), ('mehroon', 'color', 'maroon'), ('maroon', 'color', 'maroon'),
  ('sunehra', 'color', 'gold'), ('sunehri', 'color', 'gold'), ('golden', 'color', 'gold'),
  ('chandi', 'color', 'silver'), ('asmani', 'color', 'sky blue'),
  -- Hinglish / spelling variants -> English the model understands
  ('shaadi', 'rewrite', 'wedding'), ('shadi', 'rewrite', 'wedding'), ('vivah', 'rewrite', 'wedding'),
  ('byah', 'rewrite', 'wedding'), ('dulha', 'rewrite', 'groom'), ('dulhan', 'rewrite', 'bride'),
  ('tyohar', 'rewrite', 'festive'), ('tyohaar', 'rewrite', 'festive'), ('tehwar', 'rewrite', 'festive'),
  ('garmi', 'rewrite', 'summer'), ('garmiyon', 'rewrite', 'summer'),
  ('sardi', 'rewrite', 'winter'), ('sardiyon', 'rewrite', 'winter'),
  ('daftar', 'rewrite', 'office'), ('roz', 'rewrite', 'daily wear'), ('rozana', 'rewrite', 'daily wear'),
  ('joote', 'rewrite', 'shoes'), ('jootey', 'rewrite', 'shoes'), ('juta', 'rewrite', 'shoes'),
  ('chappal', 'rewrite', 'sandals'), ('chappals', 'rewrite', 'sandals'),
  ('kolhapuri chappal', 'rewrite', 'kolhapuri'),
  ('juti', 'rewrite', 'jutti'), ('mojari', 'rewrite', 'jutti'), ('mojaris', 'rewrite', 'jutti'),
  ('kurti', 'rewrite', 'kurta'), ('kurtis', 'rewrite', 'kurta'),
  ('sari', 'rewrite', 'saree'), ('saris', 'rewrite', 'saree'), ('sarees', 'rewrite', 'saree'),
  ('lehnga', 'rewrite', 'lehenga'), ('lengha', 'rewrite', 'lehenga'), ('lahenga', 'rewrite', 'lehenga'),
  ('chunni', 'rewrite', 'dupatta'), ('chunri', 'rewrite', 'dupatta'), ('odhni', 'rewrite', 'dupatta'),
  ('achkan', 'rewrite', 'sherwani'),
  ('kapde', 'rewrite', 'clothes'), ('kapda', 'rewrite', 'fabric'),
  ('reshmi', 'rewrite', 'silk'), ('resham', 'rewrite', 'silk'), ('sooti', 'rewrite', 'cotton'),
  ('ke liye', 'rewrite', 'for'), ('ki liye', 'rewrite', 'for'), ('wala', 'rewrite', ''),
  ('wali', 'rewrite', ''), ('wale', 'rewrite', ''), ('waala', 'rewrite', ''), ('waali', 'rewrite', '');

-- helpers ------------------------------------------------------------

create or replace function search.re_escape(t text)
returns text language sql immutable
as $$ select regexp_replace(t, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') $$;

-- "1500" -> 1500, "1.5k" -> 1500
create or replace function search.to_amount(t text)
returns numeric language sql immutable
as $$
  select trim_scale(case when t like '%k' then rtrim(t, 'k')::numeric * 1000 else t::numeric end)
$$;

-- parser -------------------------------------------------------------

create or replace function public.parse_search_query(q text)
returns jsonb
language plpgsql stable security definer
set search_path = public, search
as $$
declare
  cur   constant text := '(?:rs\.?\s*|₹\s*|inr\s*)?';           -- optional currency prefix
  amt   constant text := '(\d+(?:\.\d+)?k?)';                    -- 1500 / 1.5k
  suf   constant text := '(?:\s*(?:rs|rupees|rupaye|inr|/-))?';  -- optional currency suffix

  s          text := ' ' || lower(coalesce(q, '')) || ' ';
  m          text[];
  pat        text;
  price_min  numeric;
  price_max  numeric;
  colors     text[] := '{}';
  genders    text[] := '{}';
  sizes      text[] := '{}';
  brand_ids  bigint[] := '{}';
  brands     text[] := '{}';
  r          record;
begin
  s := regexp_replace(s, '''s\M', '', 'g');                 -- men's -> men
  s := regexp_replace(s, '[,;!?()"]', ' ', 'g');
  s := regexp_replace(s, '\s+', ' ', 'g');

  -- price range: "between 1000 and 2000", "from 1k to 2k", "rs 500-1000"
  pat := '\s(?:between|from|range)\s+' || cur || amt || suf || '\s*(?:-|to|and)\s*' || cur || amt || suf || '\s';
  m := regexp_match(s, pat);
  if m is null then
    pat := '\s(?:rs\.?\s*|₹\s*|inr\s*)' || amt || '\s*(?:-|to)\s*' || cur || amt || suf || '\s';
    m := regexp_match(s, pat);
  end if;
  if m is not null then
    price_min := search.to_amount(m[1]);
    price_max := search.to_amount(m[2]);
    s := regexp_replace(s, pat, ' ');
  end if;

  -- max price: "under 1500", "below rs 999", "upto 2k" / Hinglish "1500 se kam", "2000 tak"
  if price_max is null then
    pat := '\s(?:under|below|less than|lesser than|within|upto|up to|max|maximum|cheaper than|not more than|budget)\s+' || cur || amt || suf || '\s';
    m := regexp_match(s, pat);
    if m is null then
      pat := '\s' || cur || amt || suf || '\s+(?:se kam|se neeche|ke andar|ke under|tak|or less|and below|and under|max)\s';
      m := regexp_match(s, pat);
    end if;
    if m is not null then
      price_max := search.to_amount(m[1]);
      s := regexp_replace(s, pat, ' ');
    end if;
  end if;

  -- min price: "above 2000", "over 5k" / "2000 se upar", "1000 and above"
  if price_min is null then
    pat := '\s(?:above|over|more than|greater than|min|minimum|starting|starting at)\s+' || cur || amt || suf || '\s';
    m := regexp_match(s, pat);
    if m is null then
      pat := '\s' || cur || amt || suf || '\s+(?:se upar|se zyada|se jyada|and above|or more|plus|\+)\s';
      m := regexp_match(s, pat);
    end if;
    if m is not null then
      price_min := search.to_amount(m[1]);
      s := regexp_replace(s, pat, ' ');
    end if;
  end if;

  -- sizes: "size m", "size 40", "uk 8", "xl", "xxl"
  for m in select regexp_matches(s, '\m(?:size|uk)\s+(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|\d{1,2})\M', 'g') loop
    sizes := sizes || case when m[1] ~ '^\d+$' then 'UK ' || m[1] else upper(m[1]) end;
  end loop;
  s := regexp_replace(s, '\m(?:size|uk)\s+(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|\d{1,2})\M', ' ', 'g');
  for m in select regexp_matches(s, '\m(xxs|xs|xl|xxl|xxxl)\M', 'g') loop
    sizes := sizes || upper(m[1]);
  end loop;
  s := regexp_replace(s, '\m(xxs|xs|xl|xxl|xxxl)\M', ' ', 'g');

  -- brands (longest names first)
  for r in select b.id, lower(b.name) as name, b.name as display from brands b order by length(b.name) desc loop
    pat := '\m' || search.re_escape(r.name) || '\M';
    if s ~ pat then
      brand_ids := brand_ids || r.id;
      brands    := brands || r.display;
      s := regexp_replace(s, pat, ' ', 'g');
    end if;
  end loop;

  -- colors present in the catalog (multi-word first: "navy blue" before "blue")
  for r in select c.color from (select distinct lower(v.color) as color from product_variants v where v.color is not null) c
            order by length(c.color) desc loop
    pat := '\m' || search.re_escape(r.color) || '\M';
    if s ~ pat then
      colors := colors || r.color;
      s := regexp_replace(s, pat, ' ', 'g');
    end if;
  end loop;

  -- synonyms (multi-word first)
  for r in select * from search.synonyms order by length(term) desc loop
    pat := '\m' || search.re_escape(r.term) || '\M';
    if s ~ pat then
      if r.kind = 'color' then
        colors := colors || r.value;
        s := regexp_replace(s, pat, ' ', 'g');
      elsif r.kind = 'gender' then
        genders := genders || r.value;
        s := regexp_replace(s, pat, ' ', 'g');
      else
        s := regexp_replace(s, pat, r.value, 'g');
      end if;
    end if;
  end loop;

  -- tidy the leftover text
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'));
  s := regexp_replace(s, '^((for|in|with|of|and|the|a|an|ke|ka|ki|liye|me|mein|se)\s+)+', '');
  s := regexp_replace(s, '(\s+(for|in|with|of|and|the|a|an|ke|ka|ki|liye|me|mein|se|under|below|rs|price))+$', '');
  s := regexp_replace(s, '^(for|in|with|of|and|the|a|an|ke|ka|ki|liye|me|mein|se)$', '');

  return jsonb_build_object(
    'original', q,
    'text', btrim(s),
    -- a single token with a digit (SKU-1234, ab12) is a code: skip vector search
    'mode', case when btrim(s) ~ '^\S*\d\S*$' and length(btrim(s)) >= 4 then 'keyword' else 'hybrid' end,
    'filters', jsonb_strip_nulls(jsonb_build_object(
      'price_min', price_min,
      'price_max', price_max,
      'colors',    case when cardinality(colors)    > 0 then to_jsonb(array(select distinct unnest(colors)))   end,
      'genders',   case when cardinality(genders)   > 0 then to_jsonb(array(select distinct unnest(genders)))  end,
      'sizes',     case when cardinality(sizes)     > 0 then to_jsonb(array(select distinct unnest(sizes)))    end,
      'brand_ids', case when cardinality(brand_ids) > 0 then to_jsonb(brand_ids) end,
      'brands',    case when cardinality(brands)    > 0 then to_jsonb(brands) end
    ))
  );
end;
$$;

revoke execute on function public.parse_search_query(text) from public;
grant execute on function public.parse_search_query(text) to anon, authenticated, service_role;
