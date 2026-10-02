-- =====================================================================
-- Embedding sync worker + query embedding cache.
--   trigger marks row dirty -> pg_cron (every 10s) pings the
--   embed-worker Edge Function -> it claims a batch, embeds with
--   gte-small, saves. Hash checks make every step idempotent.
-- =====================================================================

-- Claim a batch of stale rows (2-minute lease so a crashed worker's
-- batch is retried).
create or replace function public.claim_embedding_jobs(batch_size integer default 10)
returns table (product_id bigint, content text, content_hash text)
language sql volatile security definer
set search_path = ''
as $$
  update search.product_search ps
     set embed_claimed_at = now()
   where ps.product_id in (
           select d.product_id
             from search.product_search d
            where d.embedded_hash is distinct from d.content_hash
              and (d.embed_claimed_at is null or d.embed_claimed_at < now() - interval '2 minutes')
            order by d.updated_at
            limit batch_size
            for update skip locked)
  returning ps.product_id, ps.content, ps.content_hash;
$$;

-- items: [{product_id, content_hash, embedding: [..384 floats..]}]
-- An embedding is only stored if the document hasn't changed since it
-- was claimed; otherwise the row stays dirty and is picked up again.
create or replace function public.save_embeddings(items jsonb)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update search.product_search ps
     set embedding        = case when ps.content_hash = i ->> 'content_hash'
                                 then (i ->> 'embedding')::extensions.vector else ps.embedding end,
         embedded_hash    = case when ps.content_hash = i ->> 'content_hash'
                                 then i ->> 'content_hash' else ps.embedded_hash end,
         embed_claimed_at = null
    from jsonb_array_elements(items) i
   where ps.product_id = (i ->> 'product_id')::bigint;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Index health, handy for the demo UI.
create or replace function public.embedding_status()
returns table (total bigint, embedded bigint, pending bigint)
language sql stable security definer
set search_path = ''
as $$
  select count(*),
         count(*) filter (where embedded_hash = content_hash),
         count(*) filter (where embedded_hash is distinct from content_hash)
    from search.product_search;
$$;

-- ---------------------------------------------------------------------
-- Query embedding cache: popular queries skip the model entirely.
-- ---------------------------------------------------------------------
create table search.query_cache (
  query        text primary key,               -- normalized query text
  embedding    extensions.vector(384) not null,
  hits         integer not null default 1,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

-- One round trip for the search Edge Function: parse the query and
-- return a cached embedding for its text part if we have one.
create or replace function public.search_prepare(q text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  parsed jsonb := public.parse_search_query(q);
  t      text  := parsed ->> 'text';
  emb    text;
begin
  if t <> '' then
    update search.query_cache
       set hits = hits + 1, last_used_at = now()
     where query = t
    returning embedding::text into emb;
  end if;
  return parsed || jsonb_build_object('cached_embedding', emb);
end;
$$;

create or replace function public.cache_query_embedding(q text, embedding extensions.vector(384))
returns void
language sql volatile security definer
set search_path = ''
as $$
  insert into search.query_cache (query, embedding) values (q, embedding)
  on conflict (query) do update set last_used_at = now();
$$;

revoke execute on function public.claim_embedding_jobs(integer) from public, anon, authenticated;
revoke execute on function public.save_embeddings(jsonb) from public, anon, authenticated;
revoke execute on function public.search_prepare(text) from public, anon, authenticated;
revoke execute on function public.cache_query_embedding(text, extensions.vector) from public, anon, authenticated;
grant execute on function public.claim_embedding_jobs(integer) to service_role;
grant execute on function public.save_embeddings(jsonb) to service_role;
grant execute on function public.search_prepare(text) to service_role;
grant execute on function public.cache_query_embedding(text, extensions.vector) to service_role;

revoke execute on function public.embedding_status() from public;
grant execute on function public.embedding_status() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- pg_cron -> Edge Function. Needs two Vault secrets (see README):
--   project_url          https://<ref>.supabase.co
--   embed_worker_secret  same value as the EMBED_WORKER_SECRET function secret
-- ---------------------------------------------------------------------
create or replace function search.invoke_embed_worker(max_parallel integer default 5)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  base_url text;
  secret   text;
  pending  integer;
  n        integer;
begin
  select count(*) into pending
    from search.product_search
   where embedded_hash is distinct from content_hash
     and (embed_claimed_at is null or embed_claimed_at < now() - interval '2 minutes');
  if pending = 0 then
    return 0;   -- nothing to do: don't wake the function
  end if;

  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into secret   from vault.decrypted_secrets where name = 'embed_worker_secret';
  if base_url is null or secret is null then
    raise warning 'search: vault secrets project_url / embed_worker_secret are not set';
    return 0;
  end if;

  -- Each call embeds a few products (CPU-limited), so fan out for backlogs.
  -- pg_net requests are async: this returns immediately.
  n := least(max_parallel, ceil(pending / 3.0)::integer);
  for i in 1..n loop
    perform net.http_post(
      url     := base_url || '/functions/v1/embed-worker',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', secret),
      body    := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  end loop;
  return n;
end;
$$;

select cron.schedule('search-embed-worker', '10 seconds', 'select search.invoke_embed_worker()');
