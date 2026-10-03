import { createClient } from "@supabase/supabase-js";
import type { SearchResponse, Suggestion } from "./types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && key);

export const supabase = createClient(url ?? "http://localhost", key ?? "missing");

// products.image_url is a path in the public "product-images" bucket (or a full URL).
export function imageUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
}

// Keystroke path: straight to Postgres (pg_trgm + prefix FTS), no Edge Function.
export async function autocomplete(prefix: string): Promise<Suggestion[]> {
  const { data, error } = await supabase.rpc("autocomplete", { prefix, limit_count: 6 });
  if (error) throw error;
  return data ?? [];
}

// Natural-language path: Edge Function parses filters, embeds, runs hybrid search.
export async function search(q: string, limit = 24): Promise<SearchResponse> {
  const { data, error } = await supabase.functions.invoke<SearchResponse>("search", {
    body: { q, limit },
  });
  if (error) throw error;
  return data!;
}

export async function embeddingStatus() {
  const { data } = await supabase.rpc("embedding_status");
  return (data?.[0] ?? null) as { total: number; embedded: number; pending: number } | null;
}
