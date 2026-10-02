// Claims stale product_search rows, embeds them, saves the vectors.
// Triggered every 10s by pg_cron (only when there is work), or manually
// via `npm run backfill`.
//
// Edge Functions have a ~2s CPU limit per request and gte-small inference
// counts against it, so we work one product at a time within a time budget
// and save after each one. If the request is killed anyway, at most one
// claimed row is lost (its lease expires and it is retried).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { embed } from "../_shared/embed.ts";
import { json } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const DEFAULT_BUDGET_MS = 700; // leaves headroom for one last embed to finish under the CPU limit

Deno.serve(async (req) => {
  const secret = Deno.env.get("EMBED_WORKER_SECRET");
  if (!secret || req.headers.get("x-worker-secret") !== secret) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const budgetMs = Math.min(Math.max(Number(body.budget_ms) || DEFAULT_BUDGET_MS, 200), 1500);
  const started = performance.now();
  let processed = 0;
  let embedMs = 0;

  while (performance.now() - started < budgetMs) {
    const { data: jobs, error } = await supabase.rpc("claim_embedding_jobs", { batch_size: 1 });
    if (error) return json({ error: error.message, processed }, 500);
    if (!jobs?.length) break;

    const job = jobs[0];
    const t = performance.now();
    const embedding = await embed(job.content);
    embedMs += performance.now() - t;

    const { error: saveError } = await supabase.rpc("save_embeddings", {
      items: [{ product_id: job.product_id, content_hash: job.content_hash, embedding }],
    });
    if (saveError) return json({ error: saveError.message, processed }, 500);
    processed++;
  }

  return json({
    processed,
    avg_embed_ms: processed ? Math.round(embedMs / processed) : null,
  });
});
