// Drains the embedding queue by calling the embed-worker repeatedly.
// pg_cron does this automatically every 10s; use this after a bulk import
// to index faster.   npm run backfill
const { SUPABASE_URL, EMBED_WORKER_SECRET } = process.env;
if (!SUPABASE_URL || !EMBED_WORKER_SECRET) {
  console.error("Set SUPABASE_URL and EMBED_WORKER_SECRET in .env");
  process.exit(1);
}

const PARALLEL = 3;
let total = 0;

async function worker() {
  let failures = 0;
  for (;;) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/embed-worker`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": EMBED_WORKER_SECRET },
      body: "{}",
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: String(e) }) }));
    const body = await res.json().catch(() => ({}));

    if (res.status === 401) throw new Error("embed-worker rejected EMBED_WORKER_SECRET");
    if (!res.ok) {
      // 546 = CPU limit hit mid-embed, 503 = cold start; both are transient.
      if (++failures >= 10) throw new Error(`embed-worker keeps failing (${res.status}): ${JSON.stringify(body)}`);
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    failures = 0;
    if (!body.processed) return;
    total += body.processed;
    process.stdout.write(`embedded ${total}`);
  }
}

await Promise.all(Array.from({ length: PARALLEL }, worker));
console.log(`\ndone, ${total} products embedded`);
