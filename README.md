# Postgres e-commerce search

Natural-language product search for small online stores, running **inside the Postgres they already have**. No Elasticsearch or Algolia, and no extra servers.

```
"laal cotton kurti 1.5k se kam for ladies"
   → filters  { color: red, gender: women, price ≤ 1500 }   (plain SQL)
   → text     "cotton kurta"                                (keyword + vector search)
```

Built on Supabase: **pgvector** (semantic), **pg_trgm** + full-text (keyword, typos), **pg_cron** + an Edge Function running **gte-small** (embeddings, no API bill).

## How it works

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

```sql
select parse_search_query('red silk saree under 5000 for wedding');
select * from autocomplete('kur');
select * from search_products('silk saree', null, '{"price_max": 5000}');  -- keyword-only (no embedding)
select * from embedding_status();
```

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
