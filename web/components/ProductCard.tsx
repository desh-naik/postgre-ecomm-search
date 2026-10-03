import { imageUrl } from "@/lib/supabase";
import type { Product } from "@/lib/types";

const SWATCHES: Record<string, string> = {
  red: "#c0392b", maroon: "#7b1e2b", black: "#222", white: "#f4f4f2", "off white": "#efe9dc",
  "navy blue": "#1f2f57", blue: "#2f6fd1", "sky blue": "#8ec5ee", green: "#2e8b57", olive: "#6b6b2e",
  "bottle green": "#0f4d34", yellow: "#f2c230", mustard: "#c9a227", pink: "#e98aa8", peach: "#f4b393",
  orange: "#e67e22", purple: "#7d3c98", brown: "#7a4a2a", tan: "#c19a6b", beige: "#d9c8a9", gold: "#c8a24a",
  silver: "#b9bcc2", grey: "#8a8f98", cream: "#f3e7c9", wine: "#5e1a2e", teal: "#16807d", lavender: "#b9a6dc",
};

export function colorSwatch(color?: string | null) {
  return SWATCHES[color?.toLowerCase() ?? ""] ?? "#ccc";
}

export function formatPrice(n: number) {
  return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export default function ProductCard({ p, debug }: { p: Product; debug: boolean }) {
  const colors = p.colors ?? [];
  const discount = p.mrp && p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
  const src = imageUrl(p.image_url);

  return (
    <article className={`card ${p.in_stock ? "" : "oos"}`}>
      <div
        className="card-image"
        style={{
          background: colors.length > 1
            ? `linear-gradient(135deg, ${colors.map(colorSwatch).join(", ")})`
            : colorSwatch(colors[0]),
        }}
      >
        {src && <img src={src} alt={p.name} loading="lazy" />}
        <span className="card-category">{p.category}</span>
        {!p.in_stock && <span className="badge-oos">Out of stock</span>}
      </div>
      <div className="card-body">
        <div className="card-brand">{p.brand}</div>
        <h3 className="card-name">{p.name}</h3>
        <div className="card-colors">
          {colors.map((c) => (
            <span key={c} className="dot" title={c} style={{ background: colorSwatch(c) }} />
          ))}
          <span className="card-gender">{p.gender}</span>
        </div>
        <div className="card-price">
          <strong>{formatPrice(p.price)}</strong>
          {discount > 0 && (
            <>
              <s>{formatPrice(p.mrp!)}</s>
              <span className="discount">{discount}% off</span>
            </>
          )}
        </div>
        {debug && (
          <div className="card-debug">
            <span title="Rank on keyword side">kw #{p.keyword_rank ?? "–"}</span>
            <span title="Rank on vector side">vec #{p.semantic_rank ?? "–"}</span>
            <span title="Cosine similarity">sim {p.similarity?.toFixed(3) ?? "–"}</span>
            <span title="Final fused score">score {p.score.toFixed(4)}</span>
          </div>
        )}
      </div>
    </article>
  );
}
