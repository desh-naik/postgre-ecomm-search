// Public search endpoint.
//   1. search_prepare: parse filters out of the query + cached embedding lookup
//   2. embed the remaining text with gte-small (unless cached)
//   3. search_products: hybrid keyword + vector search with RRF
import { createClient } from "jsr:@supabase/supabase-js@2";
import { embed } from "../_shared/embed.ts";
import { corsHeaders, json } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type SearchRequest = {
  q?: string;
  filters?: Record<string, unknown>;
  limit?: number;
  semantic?: boolean; // false = keyword only
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const started = performance.now();
  const body: SearchRequest = req.method === "POST"
    ? await req.json().catch(() => ({}))
    : { q: new URL(req.url).searchParams.get("q") ?? "" };

  const q = (body.q ?? "").slice(0, 200);
  const limit = Math.min(Math.max(Number(body.limit) || 24, 1), 100);

  const { data: prepared, error: prepError } = await supabase.rpc("search_prepare", { q });
  if (prepError) return json({ error: prepError.message }, 500);

  const text: string = prepared.text ?? "";
  const timings: Record<string, number> = { prepare: Math.round(performance.now() - started) };

  let embedding: string | number[] | null = null;
  let cacheHit = false;
  if (text && body.semantic !== false && prepared.mode !== "keyword") {
    if (prepared.cached_embedding) {
      embedding = prepared.cached_embedding;
      cacheHit = true;
    } else {
      const t = performance.now();
      embedding = await embed(text);
      timings.embed = Math.round(performance.now() - t);
      // fire-and-forget: don't make the user wait for the cache write
      supabase.rpc("cache_query_embedding", { q: text, embedding }).then(() => {});
    }
  }

  const filters = { ...(prepared.filters ?? {}), ...(body.filters ?? {}) };
  const t = performance.now();
  const { data: results, error } = await supabase.rpc("search_products", {
    query_text: text,
    query_embedding: embedding,
    filters,
    match_count: limit,
  });
  if (error) return json({ error: error.message }, 500);
  timings.search = Math.round(performance.now() - t);
  timings.total = Math.round(performance.now() - started);

  return json({
    query: q,
    text,
    filters,
    cache_hit: cacheHit,
    timings,
    results,
  });
});
