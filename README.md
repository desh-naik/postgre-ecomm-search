# Postgres e-commerce search

Natural-language product search for small online stores, running **inside the Postgres they already have**. No Elasticsearch or Algolia, and no extra servers.

```
"laal cotton kurti 1.5k se kam for ladies"
   → filters  { color: red, gender: women, price ≤ 1500 }   (plain SQL)
   → text     "cotton kurta"                                (keyword + vector search)
```

Built on Supabase: **pgvector** (semantic), **pg_trgm** + full-text (keyword, typos), **pg_cron** + an Edge Function running **gte-small** (embeddings, no API bill).

> **New here?** Most of the logic lives in SQL functions inside Postgres, not in application code. That's on purpose: the search runs next to the data, and the app stays thin. The sections below walk through it in plain language. Start with [the big picture](#the-big-picture), then [follow one search](#follow-one-search-through-the-code).

## The big picture

There are two flows. One keeps the search index up to date when products change. The other answers a shopper's query.

```mermaid
flowchart LR
  subgraph Sync["① Keeping the index fresh (background)"]
    direction LR
    A[Store edits a product] -->|trigger| B[search.product_search<br/>row rebuilt, marked stale]
    B --> C{{pg_cron<br/>every 10s}}
    C -->|pg_net HTTP call| D[embed-worker<br/>Edge Function]
    D -->|gte-small| E[384-number vector saved]
  end

  subgraph Query["② Answering a search"]
    direction LR
    U[Shopper types<br/>'red kurti under 1500'] --> W[web app]
    W -->|"1-2 words"| AC["autocomplete()<br/>SQL only, ~10ms"]
    W -->|"3+ words or Enter"| S[search<br/>Edge Function]
    S --> P["parse_search_query()<br/>color=red, price≤1500"]
    S -->|gte-small| V[query vector]
    P --> H["search_products()<br/>keyword + typo + vector"]
    V --> H
    H --> R[ranked products]
  end
```

**What runs where:**

| Inside Postgres (SQL / PL/pgSQL) | In Edge Functions (Deno / TypeScript) |
|---|---|
| Parsing filters out of the query | Running the gte-small AI model |
| Keyword, typo and vector search, plus ranking | Thin glue: receive the request, call SQL, return JSON |
| Triggers that keep the index in sync | |
| The embedding job queue, scheduling (pg_cron) and HTTP calls (pg_net) | |

The Edge Functions exist mainly because the AI model runs in the Deno runtime, not inside Postgres. Everything else is plain Postgres plus two open-source extensions (pgvector, pg_trgm), so it isn't tied to Supabase.

## Three kinds of search, in two minutes

Each method covers a weakness of the others. The search runs all three and merges the results.

| Method | Postgres feature | Stores | Good at | Example |
|---|---|---|---|---|
| **Keyword** | `tsvector` (built in) + GIN index | Word stems: `'run':1 'shoe':2` | Exact terms, brands, specific words | "nike", "waterproof" |
| **Typo-tolerant** | `pg_trgm` + GIN index | 3-letter chunks of the text | Misspellings, partial words | "sneekers", "kur…" |
| **Semantic** | `vector(384)` (pgvector) + HNSW index | 384 numbers that represent meaning | Different wording for the same thing | "shoes for jogging" finds "running sneakers" |

`tsvector` and `vector` sound alike but are opposites: `tsvector` matches **words** exactly, `vector` measures how close two texts are in **meaning**.

**Merging the rankings:** each method ranks the products. [Reciprocal Rank Fusion](https://www.elastic.co/guide/en/elasticsearch/reference/current/rrf.html) gives each product `1 / (50 + its rank)` for each method that found it, and adds the numbers up. A product found near the top by both keyword and vector search wins.

## Follow one search through the code

The query is **"laal cotton kurti 1.5k se kam for ladies"** (Hinglish for "red cotton kurti under 1.5k for women").

**1. The web app picks a path.** [`web/components/SearchBox.tsx`](web/components/SearchBox.tsx#L43): under 3 words, it calls `autocomplete()` straight in Postgres. Otherwise it calls the `search` Edge Function through [`web/lib/supabase.ts`](web/lib/supabase.ts#L19).

**2. The Edge Function takes the request.** [`supabase/functions/search/index.ts`](supabase/functions/search/index.ts) is about 70 lines. It calls `search_prepare`, which parses the query and looks up a cached embedding.

**3. Filters are pulled out with rules, not an LLM.** [`parse_search_query()`](supabase/migrations/20261002000004_query_parser.sql#L80):
```json
{ "text": "cotton kurta",
  "filters": { "colors": ["red"], "genders": ["women"], "price_max": 1500 } }
```
`laal` → red and `kurti` → kurta come from a synonym table. `1.5k se kam` → `price_max: 1500`. Brands and colors are matched against the real catalog.

**4. The remaining text becomes a vector.** [`_shared/embed.ts`](supabase/functions/_shared/embed.ts): "cotton kurta" goes into gte-small and comes out as 384 numbers. The model runs inside the Supabase Edge Runtime, so there's no API key and no bill. The result is cached for the next person who searches the same thing.

**5. The hybrid search runs.** [`search_products()`](supabase/migrations/20261002000005_search_functions.sql#L91):
- filters are applied with plain SQL (`price <= 1500`, `color = red`, …)
- keyword search ranks matches on "cotton kurta"
- vector search ranks by closeness in meaning
- RRF merges the two rankings, then in-stock and popularity boosts are added

**6. JSON goes back** with the results, the parsed filters and timings for each step.

## How a product change reaches the index

This is the part people usually find hardest to follow, because nothing in the app code calls it. It's all triggers and a scheduler.

**The trick is two fingerprints per product** in `search.product_search`:

| Column | Meaning |
|---|---|
| `content_hash` | `md5()` of the product's **current** search text |
| `embedded_hash` | `md5()` of the text the **vector was made from** |

When they differ, the vector is stale. There's no separate queue table: "needs work" just means the fingerprints don't match.

**Example:** `update products set description = '…' where id = 345;`

1. **A trigger fires** on `products` and calls [`refresh_product(345)`](supabase/migrations/20261002000003_search_index.sql#L79).
2. [`build_document()`](supabase/migrations/20261002000003_search_index.sql#L45) rebuilds the product's search text from 5 tables: name, brand, category, colors, attributes and description.
3. `content_hash` gets the new fingerprint. `embedded_hash` still has the old one, so the row is now **stale**.
4. **Within 10 seconds,** pg_cron runs [`invoke_embed_worker()`](supabase/migrations/20261002000006_embedding_worker.sql#L123). It sees the stale row and calls the `embed-worker` Edge Function over HTTP (pg_net).
5. [`embed-worker`](supabase/functions/embed-worker/index.ts) **claims** the row with a 2-minute lease, makes the vector, and calls [`save_embeddings()`](supabase/migrations/20261002000006_embedding_worker.sql#L31).
6. `save_embeddings()` saves the vector **only if the fingerprint still matches** the one the worker started with. If the product was edited again in the meantime, the vector is thrown away and the row is retried with the new text.

**Changes that update the index:** product name, description and gender; variant colors; attributes; brand names (every product of that brand); category names (every product in that category).

**Changes that don't:** price, stock and rating. They change often and are filtered with plain SQL, so re-embedding would be wasted work. SKUs are only used for keyword search, so they don't affect the vector either.

**Watch it happen** in any SQL client:
```sql
select * from embedding_status();                                   -- total / embedded / pending
select status, start_time from cron.job_run_details order by runid desc limit 5;  -- cron firing
select status_code, content, created from net._http_response order by id desc limit 5;  -- worker replies
```

## Design decisions

**Why a separate `search` schema rather than an `embedding` column on `products`?**
- The search text combines **5 tables**, so it's derived data, like an index card, not part of the catalog.
- **The store's tables aren't modified.** You can add this to an existing shop, and remove it by dropping one schema.
- Supabase exposes `public` as a REST API automatically. Keeping vectors, hashes and leases in `search` keeps them off the API. The only way in is through chosen functions.
- Frequent price and stock updates on `products` don't compete for locks with the embedding worker, and don't rewrite rows carrying a large vector.

**Why SQL functions rather than application code?** Search, filtering and ranking happen next to the data with no back-and-forth between app and database. Triggers keep the index consistent in the same transaction as the product change. There's no separate search service to run and keep in sync.

**Why `language sql` for some functions and `plpgsql` for others?** `sql` is for single queries, which the planner can inline (7 functions). `plpgsql` is for anything with variables, branches, loops or triggers (11 functions).

## Where to start reading

| Order | File | What you'll learn |
|---|---|---|
| 1 | [`functions/search/index.ts`](supabase/functions/search/index.ts) | The whole request flow in about 70 lines of TypeScript |
| 2 | [`migrations/…04_query_parser.sql`](supabase/migrations/20261002000004_query_parser.sql) | Turning free text into filters with rules and a synonym table |
| 3 | [`migrations/…05_search_functions.sql`](supabase/migrations/20261002000005_search_functions.sql) | Hybrid search and RRF ranking, and autocomplete |
| 4 | [`migrations/…03_search_index.sql`](supabase/migrations/20261002000003_search_index.sql) | The search table, its indexes and the sync triggers |
| 5 | [`migrations/…06_embedding_worker.sql`](supabase/migrations/20261002000006_embedding_worker.sql) + [`functions/embed-worker`](supabase/functions/embed-worker/index.ts) | Job queue, leases, pg_cron and pg_net |
| — | [`migrations/…01`](supabase/migrations/20261002000001_extensions.sql), [`…02`](supabase/migrations/20261002000002_catalog.sql) | Extensions, and a typical store catalog (unchanged by search) |

## Components at a glance

| Layer | What | Where |
|---|---|---|
| Search document | Each product and its related tables (brand, category, colors, attributes) are flattened into one text. Price and stock are left out. | `search.build_document()` |
| Index | `search.product_search` holds the document, `tsvector`s, trigram index and the `vector(384)` embedding. It lives in its own table and schema, so **the store's tables aren't modified**. | migration `…03` |
| Sync | Triggers on products, variants, attributes, brands and categories rebuild the document. If `md5(content)` changed, the row becomes "dirty". Stock and price updates never trigger re-embedding. | migration `…03` |
| Embedding worker | Every 10s pg_cron checks for dirty rows and calls the `embed-worker` Edge Function. The function claims a batch with a lease, embeds it with gte-small, and saves only if the hash still matches. | migration `…06`, `functions/embed-worker` |
| Query parser | Rules, no LLM. It extracts price ("under 1500", "1.5k se kam", "between 1k and 2k"), sizes ("size xl", "uk 8"), brands and colors from the catalog, and genders. A Hinglish synonym table handles terms like laal→red, shaadi→wedding and joote→shoes. | `parse_search_query()` |
| Autocomplete | Runs on each keystroke. Prefix full-text search plus trigram similarity on names, brands and categories (around 10ms), with no embeddings. | `autocomplete()` |
| Search | Hybrid **Reciprocal Rank Fusion** of keyword rank and vector rank, with in-stock and popularity boosts. When filters are present it scans only the matching products exactly; otherwise it uses HNSW. | `search_products()` |
| API | The `search` Edge Function parses the query, embeds it (or uses the cached embedding), then runs the search. | `functions/search` |

The UI calls `autocomplete` while the shopper types fewer than 3 words, and switches to the `search` function for longer phrases or on Enter.

## Project layout

```
supabase/
  migrations/      schema, search index, parser, search functions, worker + cron
  functions/       search (public API), embed-worker (cron target)
  seed.sql         generated demo catalog (478 Indian fashion products)
scripts/
  generate-seed.mjs  regenerate seed.sql
  backfill.mjs       drain the embedding queue quickly after a bulk import
web/               Next.js demo store with the autocomplete dropdown
```

## Setup (hosted Supabase)

You need Node 20+ and a Supabase project.

1. **Log in and link** the CLI. `link` asks for your database password:
   ```bash
   npx supabase login
   ```
   ```bash
   npx supabase link --project-ref YOUR-PROJECT-REF
   ```

2. **Create the schema and load the demo catalog:**
   ```bash
   npm run db:push
   ```

3. **Pick a worker secret** (any long random string) and give it to the Edge Functions:
   ```bash
   npx supabase secrets set EMBED_WORKER_SECRET=your-long-random-string
   ```

4. **Deploy the functions:**
   ```bash
   npm run functions:deploy
   ```

5. **Let pg_cron reach the worker.** In the Supabase SQL editor, run:
   ```sql
   select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'project_url');
   select vault.create_secret('your-long-random-string', 'embed_worker_secret');
   ```
   Indexing starts within 10 seconds. Check progress with `select * from embedding_status();`.
   To finish faster, copy `.env.example` to `.env`, fill it in, and run `npm run backfill`.

6. **Run the demo store.** Copy `web/.env.local.example` to `web/.env.local` and add your project URL and anon (publishable) key. Then run:
   ```bash
   npm install --prefix web
   ```
   ```bash
   npm run dev
   ```
   Open http://localhost:3000.

## Local development (optional, needs Docker)

The whole stack runs locally, including gte-small, pg_cron and Vault:

```bash
npx supabase start
```

Create `supabase/functions/.env` containing `EMBED_WORKER_SECRET=local-test-secret`, then run:

```bash
npx supabase functions serve --env-file supabase/functions/.env
```

In the local database, add the Vault secrets. Inside Docker, pg_cron reaches the API through the Kong container:
```sql
select vault.create_secret('http://supabase_kong_postgre-ecomm-search:8000', 'project_url');
select vault.create_secret('local-test-secret', 'embed_worker_secret');
```
Point `web/.env.local` at `http://127.0.0.1:54321` with the local anon key that `supabase start` prints.

## Using it from SQL

After `npx supabase start`, connect any SQL client (psql, DBeaver, pgAdmin) to `postgresql://postgres:postgres@127.0.0.1:54322/postgres` and try these:

```sql
select parse_search_query('laal cotton kurti 1.5k se kam for ladies');
-- {"text": "cotton kurta", "filters": {"colors": ["red"], "genders": ["women"], "price_max": 1500}, ...}

select kind, label, sublabel from autocomplete('kur');
-- category | Kurtas     | Women
-- category | Kurta Sets | Women
-- product  | Sutraa Silk Blend Floral Print Kurta Palazzo Set | Sutraa · Kurta Sets

select name, price from search_products('silk saree', null, '{"price_max": 5000}');  -- keyword-only (no embedding)
-- Rangreza Premium Pure Silk Zari Work Chiffon Saree | 1649.00

select * from embedding_status();
-- total 478 | embedded 478 | pending 0
```

Or call the full search API (semantic included):
```bash
curl "http://127.0.0.1:54321/functions/v1/search?q=red+running+shoes+under+2000"
```
The first call after a start takes longer while gte-small loads. Later calls take under a second.

## Tuning notes

- **Semantic cutoff is relative.** gte-small compresses cosine similarities into a narrow band (even gibberish scores about 0.8), so `search_products` keeps vector hits within `semantic_window` (0.05) of the best match.
- **Keyword side uses OR** so that long natural-language queries still match. `ts_rank_cd` rewards documents that match more terms.
- **Codes** (`SKU-1234`, `ab12`) skip vector search entirely.
- **Edge Function CPU limit (about 2s per request).** gte-small inference counts against it. The worker embeds one product at a time within a 700ms budget and saves after each one. For backlogs, pg_cron fans out up to 5 parallel calls per tick. An occasional 546 response (CPU limit) is expected and harmless: the leased row is retried after 2 minutes.
- **Hinglish**: gte-small is English-only. The synonym table rewrites common Hinglish terms before embedding. Store owners can add rows to `search.synonyms`.
- **Known gap**: letter transpositions ("kutra") defeat trigram matching. The vector side still mostly recovers them.

## Roadmap

- Drop-in `<script>` widget for any storefront
- Click/conversion logging to boost popular results per query
- Swap gte-small for a multilingual model (e.g. multilingual-e5-small) via a self-hosted embed service
- WooCommerce / Shopify sync adapters
