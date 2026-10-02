export type Suggestion = {
  kind: "product" | "brand" | "category";
  label: string;
  sublabel: string | null;
  product_id: number | null;
  slug: string;
  price: number | null;
  score: number;
};

export type Product = {
  id: number;
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
  gender: string | null;
  price: number;
  mrp: number | null;
  rating: number | null;
  image_url: string | null;
  colors: string[] | null;
  in_stock: boolean;
  score: number;
  keyword_rank: number | null;
  semantic_rank: number | null;
  similarity: number | null;
};

export type SearchFilters = {
  price_min?: number;
  price_max?: number;
  colors?: string[];
  genders?: string[];
  sizes?: string[];
  brands?: string[];
  brand_ids?: number[];
};

export type SearchResponse = {
  query: string;
  text: string;
  filters: SearchFilters;
  cache_hit: boolean;
  timings: Record<string, number>;
  results: Product[];
};
