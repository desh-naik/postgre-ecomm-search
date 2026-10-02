"use client";

import { useEffect, useState } from "react";
import SearchBox from "@/components/SearchBox";
import ProductCard, { formatPrice } from "@/components/ProductCard";
import { embeddingStatus, isConfigured, search } from "@/lib/supabase";
import type { SearchResponse } from "@/lib/types";

const EXAMPLES = [
  "comfortable shoes for long walks",
  "laal cotton kurti 1.5k se kam for ladies",
  "shaadi ke liye sherwani",
  "silk saree for wedding under 10k",
  "something warm for winter",
  "black formal shoes size 9",
  "Mochi Walk jutti",
  "gift for my wife",
];

export default function Home() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  const [status, setStatus] = useState<{ total: number; embedded: number; pending: number } | null>(null);

  useEffect(() => {
    if (!isConfigured) return;
    embeddingStatus().then(setStatus).catch(() => {});
    const initial = new URLSearchParams(window.location.search).get("q");
    if (initial) run(initial);
  }, []);

  async function run(query: string) {
    setQ(query);
    setLoading(true);
    setError(null);
    window.history.replaceState(null, "", `?q=${encodeURIComponent(query)}`);
    try {
      setRes(await search(query));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const f = res?.filters ?? {};
  const chips = [
    ...(f.colors ?? []).map((c) => `color: ${c}`),
    ...(f.genders ?? []).map((g) => `for: ${g}`),
    ...(f.brands ?? []).map((b) => `brand: ${b}`),
    ...(f.sizes ?? []).map((s) => `size: ${s}`),
    ...(f.price_min != null ? [`≥ ${formatPrice(f.price_min)}`] : []),
    ...(f.price_max != null ? [`≤ ${formatPrice(f.price_max)}`] : []),
  ];

  return (
    <main>
      <header className="hero">
        <div className="brand-row">
          <span className="logo">Bazaar</span>
          {status && (
            <span className="status" title="Products embedded / total">
              {status.pending > 0
                ? `Indexing… ${status.embedded}/${status.total}`
                : `${status.total} products indexed`}
            </span>
          )}
        </div>
        <h1>Search that understands shoppers</h1>
        <p className="tagline">
          Hybrid keyword + semantic search running entirely inside Postgres (pgvector + pg_trgm). No Elasticsearch, no Algolia.
        </p>
        {!isConfigured && (
          <div className="warning">
            Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in <code>web/.env.local</code>.
          </div>
        )}
        <SearchBox initialQuery={q} onSearch={run} />
        <div className="examples">
          {EXAMPLES.map((e) => (
            <button key={e} onClick={() => run(e)}>{e}</button>
          ))}
        </div>
      </header>

      {error && <div className="error">Search failed: {error}</div>}

      {res && (
        <section className="results">
          <div className="results-bar">
            <div className="understood">
              <span className="muted">Understood as</span>
              {res.text ? <span className="chip chip-text">“{res.text}”</span> : <span className="chip chip-text">browse</span>}
              {chips.map((c) => <span key={c} className="chip">{c}</span>)}
            </div>
            <div className="meta">
              <span>{res.results.length} results</span>
              <span className="muted">
                {res.timings.total}ms{res.cache_hit ? " · cached embedding" : res.timings.embed ? ` · embed ${res.timings.embed}ms` : ""}
              </span>
              <label className="debug-toggle">
                <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} /> ranking details
              </label>
            </div>
          </div>
          <div className={`grid ${loading ? "loading" : ""}`}>
            {res.results.map((p) => <ProductCard key={p.id} p={p} debug={debug} />)}
          </div>
          {!res.results.length && <p className="empty">No products match. Try loosening the price or color.</p>}
        </section>
      )}
    </main>
  );
}
