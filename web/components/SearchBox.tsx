"use client";

import { useEffect, useRef, useState } from "react";
import { autocomplete, search } from "@/lib/supabase";
import type { Product, Suggestion } from "@/lib/types";
import { colorSwatch, formatPrice } from "./ProductCard";

const AUTOCOMPLETE_DELAY = 150;
const SEMANTIC_DELAY = 350;
const SEMANTIC_MIN_WORDS = 3; // half-typed text has no meaning; embeddings only help on phrases

type Item =
  | { type: "suggestion"; s: Suggestion }
  | { type: "product"; p: Product };

export default function SearchBox({
  initialQuery = "",
  onSearch,
}: {
  initialQuery?: string;
  onSearch: (q: string) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [preview, setPreview] = useState<Product[]>([]);
  const [mode, setMode] = useState<"autocomplete" | "semantic">("autocomplete");
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const requestId = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => setQuery(initialQuery), [initialQuery]);

  useEffect(() => {
    const q = query.trim();
    const id = ++requestId.current;
    if (q.length < 2) {
      setSuggestions([]);
      setPreview([]);
      return;
    }
    const words = q.split(/\s+/).length;
    const semantic = words >= SEMANTIC_MIN_WORDS;
    // Keyword suggestions for "red sh" are misleading under "red shirt for office";
    // drop them now rather than when the slower semantic response lands.
    if (semantic) setSuggestions([]);

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        if (semantic) {
          const res = await search(q, 6);
          if (id !== requestId.current) return; // a newer keystroke won
          setMode("semantic");
          setPreview(res.results);
          setSuggestions([]);
        } else {
          const res = await autocomplete(q);
          if (id !== requestId.current) return;
          setMode("autocomplete");
          setSuggestions(res);
          setPreview([]);
        }
        setActive(-1);
      } catch (e) {
        console.error(e);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, semantic ? SEMANTIC_DELAY : AUTOCOMPLETE_DELAY);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const groups: Suggestion[] = [
    ...suggestions.filter((s) => s.kind !== "product"),
    ...suggestions.filter((s) => s.kind === "product"),
  ];
  const items: Item[] = mode === "semantic"
    ? preview.map((p) => ({ type: "product", p }))
    : groups.map((s) => ({ type: "suggestion", s }));

  function submit(q: string) {
    if (!q.trim()) return;
    requestId.current++; // drop any in-flight dropdown request
    setQuery(q);
    setOpen(false);
    onSearch(q);
  }

  function choose(item: Item) {
    if (item.type === "product") submit(item.p.name);
    else submit(item.s.label);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && active >= 0 && items[active]) choose(items[active]);
      else submit(query);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showDropdown = open && query.trim().length >= 2 && (items.length > 0 || loading);

  return (
    <div className="searchbox" ref={boxRef}>
      <div className="searchbox-input">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder='Try "laal kurti under 1500 for ladies" or "shoes for long walks"'
          aria-label="Search products"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          role="combobox"
        />
        {loading && <span className="spinner" aria-label="Loading" />}
      </div>

      {showDropdown && (
        <div className="dropdown" role="listbox">
          <div className="dropdown-mode">
            {mode === "semantic" ? "Smart results · hybrid keyword + vector search" : "Suggestions · instant keyword match"}
          </div>
          {items.map((item, i) =>
            item.type === "product" ? (
              <button
                key={`p-${item.p.id}`}
                className={`dropdown-item ${i === active ? "active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
                role="option"
                aria-selected={i === active}
              >
                <span className="swatch" style={{ background: colorSwatch(item.p.colors?.[0]) }} />
                <span className="dropdown-text">
                  <span className="dropdown-label">{item.p.name}</span>
                  <span className="dropdown-sub">
                    {item.p.category} · {item.p.colors?.join(", ")}
                  </span>
                </span>
                <span className="dropdown-price">{formatPrice(item.p.price)}</span>
              </button>
            ) : (
              <button
                key={`s-${item.s.kind}-${item.s.slug}`}
                className={`dropdown-item ${i === active ? "active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
                role="option"
                aria-selected={i === active}
              >
                <span className={`kind kind-${item.s.kind}`}>{item.s.kind}</span>
                <span className="dropdown-text">
                  <span className="dropdown-label">{highlight(item.s.label, query)}</span>
                  {item.s.sublabel && <span className="dropdown-sub">{item.s.sublabel}</span>}
                </span>
                {item.s.price != null && <span className="dropdown-price">{formatPrice(item.s.price)}</span>}
              </button>
            ),
          )}
          {mode === "semantic" && (
            <button className="dropdown-all" onClick={() => submit(query)}>
              See all results for “{query.trim()}” ↵
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function highlight(text: string, query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((part, i) =>
    words.includes(part.toLowerCase()) ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
  );
}
