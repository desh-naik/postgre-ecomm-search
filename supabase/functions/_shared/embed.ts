// gte-small runs inside the Supabase Edge Runtime: no external API, no cost.
// 384 dimensions, normalized, so cosine distance in Postgres works directly.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const session = new Supabase.ai.Session("gte-small");

export async function embed(text: string): Promise<number[]> {
  const output = await session.run(text, { mean_pool: true, normalize: true });
  return output as number[];
}
