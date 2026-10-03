// Generates supabase/seed.sql: a deterministic Indian fashion catalog
// spread across brands, categories, products, variants and attributes,
// plus one SVG illustration per product in supabase/images/products/
// (uploaded to the "product-images" Storage bucket, see config.toml).
//   node scripts/generate-seed.mjs [productCount]
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { productSvg } from "./product-art.mjs";

const TARGET = Number(process.argv[2]) || 480;

// --- deterministic PRNG (mulberry32) ---------------------------------
let seed = 20261002;
function rand() {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (min, max) => min + Math.floor(rand() * (max - min + 1));
const sample = (arr, n) => {
  const copy = [...arr];
  const out = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  return out;
};
const slugify = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sql = (v) => (v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

// --- reference data ---------------------------------------------------
const brands = [
  ["Rangreza", "Hand block-printed cotton from Jaipur artisans."],
  ["Sutraa", "Contemporary ethnic wear for the modern woman."],
  ["Kesari Looms", "Banarasi and Kanjeevaram silk weaves."],
  ["Desi Threads", "Everyday kurtas and casual ethnic wear."],
  ["Mochi Walk", "Handcrafted leather juttis and kolhapuris."],
  ["UrbanTaana", "Indo-western fusion for men."],
  ["Chandni Couture", "Bridal and occasion wear with heavy embroidery."],
  ["Khadi Kraft", "Hand-spun khadi and sustainable fabrics."],
  ["StrideOn", "Comfort sneakers and sports shoes."],
  ["Nanhe Kadam", "Ethnic wear for kids."],
  ["Peddle & Co", "Formal and office footwear."],
  ["Phulkari House", "Punjabi phulkari embroidery and dupattas."],
];

const COLORS = ["Red", "Maroon", "Black", "White", "Off White", "Navy Blue", "Blue", "Sky Blue", "Green", "Olive",
  "Bottle Green", "Yellow", "Mustard", "Pink", "Peach", "Orange", "Purple", "Brown", "Tan", "Beige", "Gold",
  "Silver", "Grey", "Cream", "Wine", "Teal", "Lavender"];
const APPAREL_SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const FOOT_SIZES = ["UK 5", "UK 6", "UK 7", "UK 8", "UK 9", "UK 10", "UK 11"];
const KIDS_SIZES = ["1-2Y", "2-3Y", "3-4Y", "5-6Y", "7-8Y", "9-10Y"];
const FREE = ["Free Size"];

// Each template: category (parent > child), gender, brands, name parts, attributes, price range.
const templates = [
  {
    parent: "Women", cat: "Kurtas", gender: "women", brands: ["Rangreza", "Sutraa", "Desi Threads", "Khadi Kraft"],
    nouns: ["Kurta", "Straight Kurta", "A-Line Kurta", "Anarkali Kurta", "Kurti"],
    material: ["Cotton", "Rayon", "Chanderi", "Linen", "Khadi", "Georgette", "Silk Blend"],
    pattern: ["Block Print", "Floral Print", "Solid", "Chikankari", "Bandhani", "Ikat", "Embroidered"],
    occasion: [["Casual", "Daily Wear"], ["Office"], ["Festive"], ["Casual", "Office"]],
    fit: ["Straight", "A-Line", "Anarkali", "Flared"],
    sizes: APPAREL_SIZES, price: [499, 2999], weight: 14,
  },
  {
    parent: "Women", cat: "Kurta Sets", gender: "women", brands: ["Sutraa", "Rangreza", "Phulkari House", "Chandni Couture"],
    nouns: ["Kurta Set with Dupatta", "Kurta Palazzo Set", "Kurta Pant Set", "Sharara Set"],
    material: ["Cotton", "Rayon", "Chanderi", "Georgette", "Silk Blend", "Muslin"],
    pattern: ["Floral Print", "Embroidered", "Mirror Work", "Gota Patti", "Block Print", "Zari Work"],
    occasion: [["Festive"], ["Festive", "Wedding Guest"], ["Casual"], ["Party"]],
    fit: ["Straight", "A-Line", "Anarkali"],
    sizes: APPAREL_SIZES, price: [1199, 5999], weight: 9,
  },
  {
    parent: "Women", cat: "Sarees", gender: "women", brands: ["Kesari Looms", "Chandni Couture", "Khadi Kraft", "Rangreza"],
    nouns: ["Saree", "Banarasi Saree", "Kanjeevaram Saree", "Chiffon Saree", "Handloom Saree", "Organza Saree"],
    material: ["Silk", "Pure Silk", "Cotton", "Chiffon", "Georgette", "Organza", "Linen", "Tussar Silk"],
    pattern: ["Zari Work", "Woven", "Printed", "Solid", "Bandhani", "Temple Border", "Embroidered"],
    occasion: [["Wedding"], ["Festive"], ["Office"], ["Party"], ["Wedding", "Festive"]],
    fit: null, sizes: FREE, price: [899, 18999], weight: 10,
  },
  {
    parent: "Women", cat: "Lehengas", gender: "women", brands: ["Chandni Couture", "Sutraa", "Kesari Looms"],
    nouns: ["Lehenga Choli", "Bridal Lehenga", "Lehenga Set", "Flared Lehenga"],
    material: ["Velvet", "Silk", "Georgette", "Net", "Raw Silk", "Organza"],
    pattern: ["Zardozi Embroidery", "Sequin Work", "Mirror Work", "Zari Work", "Gota Patti"],
    occasion: [["Wedding"], ["Bridal", "Wedding"], ["Sangeet", "Party"], ["Festive"]],
    fit: ["Flared", "A-Line"],
    sizes: ["S", "M", "L", "XL"], price: [3499, 45999], weight: 6,
  },
  {
    parent: "Women", cat: "Dupattas", gender: "women", brands: ["Phulkari House", "Rangreza", "Kesari Looms", "Khadi Kraft"],
    nouns: ["Dupatta", "Phulkari Dupatta", "Bandhani Dupatta", "Banarasi Dupatta"],
    material: ["Cotton", "Chiffon", "Silk", "Chanderi", "Georgette", "Mul Cotton"],
    pattern: ["Phulkari Embroidery", "Bandhani", "Zari Border", "Block Print", "Tie Dye"],
    occasion: [["Festive"], ["Casual"], ["Wedding Guest"]],
    fit: null, sizes: FREE, price: [349, 2999], weight: 5,
  },
  {
    parent: "Men", cat: "Kurtas", gender: "men", brands: ["Desi Threads", "UrbanTaana", "Khadi Kraft", "Rangreza"],
    nouns: ["Kurta", "Short Kurta", "Pathani Kurta", "Kurta Pyjama Set", "Long Kurta"],
    material: ["Cotton", "Linen", "Khadi", "Silk Blend", "Jacquard", "Cotton Blend"],
    pattern: ["Solid", "Self Design", "Printed", "Chikankari", "Embroidered", "Striped"],
    occasion: [["Casual", "Daily Wear"], ["Festive"], ["Wedding Guest"], ["Office"]],
    fit: ["Regular", "Slim"],
    sizes: APPAREL_SIZES.slice(1), price: [599, 3999], weight: 11,
  },
  {
    parent: "Men", cat: "Sherwanis", gender: "men", brands: ["Chandni Couture", "UrbanTaana"],
    nouns: ["Sherwani", "Sherwani Set", "Indo-Western Sherwani", "Achkan"],
    material: ["Jacquard", "Raw Silk", "Velvet", "Brocade", "Art Silk"],
    pattern: ["Zari Work", "Thread Embroidery", "Self Design", "Sequin Work"],
    occasion: [["Wedding"], ["Groom", "Wedding"], ["Reception", "Party"]],
    fit: ["Regular", "Slim"],
    sizes: ["S", "M", "L", "XL", "XXL"], price: [4999, 34999], weight: 4,
  },
  {
    parent: "Men", cat: "Nehru Jackets", gender: "men", brands: ["UrbanTaana", "Desi Threads", "Khadi Kraft"],
    nouns: ["Nehru Jacket", "Bandhgala Jacket", "Modi Jacket", "Waistcoat"],
    material: ["Linen", "Khadi", "Jute Blend", "Velvet", "Brocade", "Tweed"],
    pattern: ["Solid", "Self Design", "Printed", "Textured"],
    occasion: [["Festive"], ["Wedding Guest"], ["Office", "Formal"]],
    fit: ["Slim", "Regular"],
    sizes: ["S", "M", "L", "XL", "XXL"], price: [999, 4999], weight: 5,
  },
  {
    parent: "Men", cat: "Shirts", gender: "men", brands: ["UrbanTaana", "Desi Threads", "Khadi Kraft"],
    nouns: ["Mandarin Collar Shirt", "Casual Shirt", "Linen Shirt", "Printed Shirt", "Short Kurta Shirt"],
    material: ["Cotton", "Linen", "Khadi", "Cotton Blend"],
    pattern: ["Solid", "Printed", "Striped", "Checked", "Block Print"],
    occasion: [["Casual"], ["Office"], ["Vacation", "Casual"]],
    fit: ["Slim", "Regular", "Relaxed"],
    sizes: APPAREL_SIZES.slice(1), price: [699, 2499], weight: 7,
  },
  {
    parent: "Footwear", cat: "Juttis", gender: "women", brands: ["Mochi Walk", "Phulkari House"],
    nouns: ["Jutti", "Punjabi Jutti", "Embroidered Mojari", "Bridal Jutti"],
    material: ["Leather", "Velvet", "Faux Leather", "Silk"],
    pattern: ["Embroidered", "Mirror Work", "Beaded", "Zari Work", "Plain"],
    occasion: [["Festive"], ["Wedding"], ["Casual"]],
    fit: null, sizes: FOOT_SIZES.slice(0, 5), price: [499, 2999], weight: 6,
  },
  {
    parent: "Footwear", cat: "Mojaris", gender: "men", brands: ["Mochi Walk"],
    nouns: ["Mojari", "Nagra Jutti", "Groom Mojari", "Leather Jutti"],
    material: ["Leather", "Velvet", "Faux Leather"],
    pattern: ["Embroidered", "Zari Work", "Plain", "Handcrafted"],
    occasion: [["Wedding"], ["Festive"], ["Groom", "Wedding"]],
    fit: null, sizes: FOOT_SIZES.slice(2), price: [799, 3999], weight: 4,
  },
  {
    parent: "Footwear", cat: "Kolhapuris", gender: "unisex", brands: ["Mochi Walk", "Khadi Kraft"],
    nouns: ["Kolhapuri Chappal", "Kolhapuri Sandals", "Toe Ring Kolhapuri"],
    material: ["Leather", "Vegan Leather"],
    pattern: ["Handcrafted", "Braided", "Plain", "Hand Painted"],
    occasion: [["Casual", "Daily Wear"], ["Festive"]],
    fit: null, sizes: FOOT_SIZES, price: [449, 1999], weight: 5,
  },
  {
    parent: "Footwear", cat: "Sneakers", gender: "unisex", brands: ["StrideOn"],
    nouns: ["Running Shoes", "Walking Shoes", "Casual Sneakers", "Training Shoes", "Slip-On Sneakers"],
    material: ["Mesh", "Knit", "Canvas", "Synthetic", "Suede"],
    pattern: ["Solid", "Colorblock", "Textured"],
    occasion: [["Sports", "Running"], ["Casual", "Daily Wear"], ["Gym", "Training"], ["Walking"]],
    fit: null, sizes: FOOT_SIZES, price: [999, 5999], weight: 8,
  },
  {
    parent: "Footwear", cat: "Formal Shoes", gender: "men", brands: ["Peddle & Co"],
    nouns: ["Oxford Shoes", "Derby Shoes", "Loafers", "Brogues", "Monk Strap Shoes"],
    material: ["Leather", "Patent Leather", "Suede", "Faux Leather"],
    pattern: ["Plain", "Brogue Detail", "Textured"],
    occasion: [["Office", "Formal"], ["Party"], ["Wedding Guest"]],
    fit: null, sizes: FOOT_SIZES.slice(2), price: [1499, 6999], weight: 5,
  },
  {
    parent: "Footwear", cat: "Sandals", gender: "women", brands: ["Mochi Walk", "StrideOn", "Peddle & Co"],
    nouns: ["Flat Sandals", "Block Heels", "Wedges", "Embellished Flats", "Comfort Sandals"],
    material: ["Leather", "Faux Leather", "Synthetic", "Suede"],
    pattern: ["Embellished", "Plain", "Braided", "Metallic"],
    occasion: [["Casual", "Daily Wear"], ["Party"], ["Festive"], ["Office"]],
    fit: null, sizes: FOOT_SIZES.slice(0, 5), price: [599, 3499], weight: 6,
  },
  {
    parent: "Kids", cat: "Boys Ethnic Wear", gender: "kids", brands: ["Nanhe Kadam", "Desi Threads"],
    nouns: ["Kurta Pyjama Set", "Dhoti Kurta Set", "Sherwani Set", "Nehru Jacket Set"],
    material: ["Cotton", "Silk Blend", "Jacquard", "Linen Blend"],
    pattern: ["Solid", "Printed", "Embroidered", "Self Design"],
    occasion: [["Festive"], ["Wedding"], ["Casual"]],
    fit: ["Regular"], sizes: KIDS_SIZES, price: [499, 2999], weight: 6,
  },
  {
    parent: "Kids", cat: "Girls Ethnic Wear", gender: "kids", brands: ["Nanhe Kadam", "Sutraa"],
    nouns: ["Lehenga Choli", "Anarkali Dress", "Pattu Pavadai", "Sharara Set", "Frock Kurta"],
    material: ["Cotton", "Silk", "Georgette", "Net", "Art Silk"],
    pattern: ["Embroidered", "Zari Work", "Printed", "Sequin Work"],
    occasion: [["Festive"], ["Wedding"], ["Party"], ["Birthday", "Party"]],
    fit: ["Flared", "A-Line"], sizes: KIDS_SIZES, price: [599, 3499], weight: 6,
  },
  {
    parent: "Accessories", cat: "Stoles & Shawls", gender: "unisex", brands: ["Khadi Kraft", "Kesari Looms", "Phulkari House"],
    nouns: ["Pashmina Shawl", "Woollen Stole", "Kani Shawl", "Cotton Stole", "Silk Stole"],
    material: ["Pashmina", "Wool", "Cotton", "Silk", "Acrylic Wool"],
    pattern: ["Woven", "Embroidered", "Printed", "Solid", "Paisley"],
    occasion: [["Winter", "Casual"], ["Festive"], ["Gifting"]],
    fit: null, sizes: FREE, price: [399, 8999], weight: 4,
  },
  {
    parent: "Accessories", cat: "Potli Bags", gender: "women", brands: ["Chandni Couture", "Phulkari House"],
    nouns: ["Potli Bag", "Embroidered Clutch", "Bridal Potli", "Box Clutch"],
    material: ["Silk", "Velvet", "Brocade", "Raw Silk"],
    pattern: ["Zardozi Embroidery", "Beaded", "Mirror Work", "Pearl Work"],
    occasion: [["Wedding"], ["Festive"], ["Party"]],
    fit: null, sizes: FREE, price: [399, 2499], weight: 4,
  },
];

const adjectives = ["Elegant", "Classic", "Royal", "Handcrafted", "Breezy", "Festive", "Everyday", "Regal", "Graceful",
  "Vintage", "Modern", "Heritage", "Lightweight", "Premium", "Comfort", "Signature"];

const featureLines = {
  Cotton: "Soft, breathable cotton that keeps you cool through Indian summers.",
  Linen: "Airy linen with a natural texture, ideal for hot and humid days.",
  Khadi: "Hand-spun, hand-woven khadi that gets softer with every wash.",
  Silk: "Lustrous silk drape with a rich festive feel.",
  "Pure Silk": "Pure mulberry silk with a heavy, luxurious drape.",
  Velvet: "Plush velvet that photographs beautifully at evening functions.",
  Leather: "Genuine leather that moulds to your feet over time.",
  Mesh: "Breathable mesh upper with cushioned sole for all-day comfort.",
  Knit: "Stretchy knit upper that hugs the foot like a sock.",
  Pashmina: "Fine Kashmiri pashmina, warm yet featherlight.",
  Wool: "Warm wool weave for chilly winter evenings.",
  Chanderi: "Sheer chanderi weave with a subtle sheen.",
  Georgette: "Flowy georgette that drapes and moves gracefully.",
};
const occasionLines = {
  Wedding: "A showstopper for weddings and receptions.",
  Bridal: "Crafted for the bride's big day.",
  Groom: "Designed for the groom and his baraat.",
  Festive: "Perfect for Diwali, Eid, Navratri and family celebrations.",
  Office: "Smart enough for the office, comfortable enough for long workdays.",
  Casual: "An easy pick for everyday outings.",
  "Daily Wear": "Low-maintenance and comfortable for daily wear.",
  Party: "Make an entrance at parties and evening events.",
  Running: "Responsive cushioning for long runs and daily jogs.",
  Walking: "Lightweight support for long walks and travel days.",
  Sports: "Grippy sole and stable fit for sports.",
  Winter: "Layer it up through North Indian winters.",
  Sangeet: "Twirl-ready for sangeet and mehendi nights.",
};

// --- generate -----------------------------------------------------------
const out = [];
out.push("-- Generated by scripts/generate-seed.mjs. Do not edit by hand.");
out.push("begin;");
out.push("truncate public.product_attributes, public.product_variants, public.products, public.categories, public.brands restart identity cascade;");

brands.forEach(([name, desc], i) => {
  out.push(`insert into public.brands (id, name, slug, description) values (${i + 1}, ${sql(name)}, ${sql(slugify(name))}, ${sql(desc)});`);
});
const brandId = Object.fromEntries(brands.map(([n], i) => [n, i + 1]));

const categories = [];
const catId = {};
for (const t of templates) {
  if (!catId[t.parent]) {
    categories.push({ id: categories.length + 1, name: t.parent, slug: slugify(t.parent), parent: null });
    catId[t.parent] = categories.length;
  }
  const key = `${t.parent}>${t.cat}`;
  if (!catId[key]) {
    categories.push({ id: categories.length + 1, name: t.cat, slug: slugify(`${t.parent} ${t.cat}`), parent: catId[t.parent] });
    catId[key] = categories.length;
  }
}
for (const c of categories) {
  out.push(`insert into public.categories (id, name, slug, parent_id) values (${c.id}, ${sql(c.name)}, ${sql(c.slug)}, ${sql(c.parent)});`);
}

const totalWeight = templates.reduce((s, t) => s + t.weight, 0);
const products = [];
const variants = [];
const attributes = [];
const usedSlugs = new Set();
let skuCounter = 1000;

for (const t of templates) {
  const count = Math.round((t.weight / totalWeight) * TARGET);
  for (let i = 0; i < count; i++) {
    const id = products.length + 1;
    const brand = pick(t.brands);
    const material = pick(t.material);
    const pattern = pick(t.pattern);
    const noun = pick(t.nouns);
    const occasions = pick(t.occasion);
    const colors = sample(COLORS, between(1, 3));
    const style = rand() < 0.5 ? pick(adjectives) + " " : "";
    const name = `${brand} ${style}${material} ${pattern === "Solid" || pattern === "Plain" ? "" : pattern + " "}${noun}`.replace(/\s+/g, " ");

    let slug = slugify(`${name} ${colors[0]}`);
    while (usedSlugs.has(slug)) slug += "-" + id;
    usedSlugs.add(slug);

    const price = Math.round(between(t.price[0], t.price[1]) / 50) * 50 - 1;
    const mrp = rand() < 0.6 ? Math.round((price * (1.2 + rand() * 0.8)) / 50) * 50 - 1 : null;
    const fit = t.fit ? pick(t.fit) : null;

    const desc = [
      `${style}${material.toLowerCase()} ${noun.toLowerCase()} by ${brand} in ${colors.join(", ").toLowerCase()}.`.replace(/^./, (c) => c.toUpperCase()),
      featureLines[material] ?? `Made from quality ${material.toLowerCase()}.`,
      pattern !== "Solid" && pattern !== "Plain" ? `Features ${pattern.toLowerCase()} detailing.` : "A clean, minimal look.",
      occasions.map((o) => occasionLines[o]).filter(Boolean)[0] ?? `Great for ${occasions.join(" and ").toLowerCase()} occasions.`,
      fit ? `${fit} fit.` : "",
    ].filter(Boolean).join(" ");

    products.push({
      id, name, slug, desc, brand_id: brandId[brand], category_id: catId[`${t.parent}>${t.cat}`], gender: t.gender,
      price, mrp, rating: (3 + rand() * 2).toFixed(1), rating_count: between(0, 2500),
      popularity: Math.floor(Math.pow(rand(), 3) * 10000),
      image_url: `${slug}.svg`,
      art: { cat: t.cat, gender: t.gender, noun, pattern, material, colors },
    });

    attributes.push([id, "material", material], [id, "pattern", pattern]);
    for (const o of occasions) attributes.push([id, "occasion", o]);
    if (fit) attributes.push([id, "fit", fit]);

    for (const color of colors) {
      for (const size of t.sizes) {
        if (t.sizes.length > 1 && rand() < 0.15) continue; // not every size made in every color
        const stock = rand() < 0.12 ? 0 : between(1, 60);
        variants.push([id, `SKU-${skuCounter++}`, color, size, stock]);
      }
    }
  }
}

for (const p of products) {
  out.push(`insert into public.products (id, name, slug, description, brand_id, category_id, gender, price, mrp, rating, rating_count, popularity, image_url) values (${p.id}, ${sql(p.name)}, ${sql(p.slug)}, ${sql(p.desc)}, ${p.brand_id}, ${p.category_id}, ${sql(p.gender)}, ${p.price}, ${sql(p.mrp)}, ${p.rating}, ${p.rating_count}, ${p.popularity}, ${sql(p.image_url)});`);
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
for (const rows of chunk(variants, 200)) {
  out.push("insert into public.product_variants (product_id, sku, color, size, stock) values\n  " +
    rows.map((r) => `(${r.map(sql).join(", ")})`).join(",\n  ") + ";");
}
for (const rows of chunk(attributes, 200)) {
  out.push("insert into public.product_attributes (product_id, name, value) values\n  " +
    rows.map((r) => `(${r.map(sql).join(", ")})`).join(",\n  ") + " on conflict do nothing;");
}

for (const table of ["brands", "categories", "products", "product_variants"]) {
  out.push(`select setval(pg_get_serial_sequence('public.${table}', 'id'), (select max(id) from public.${table}));`);
}
// Triggers already built the search docs row by row; this is a safety net.
out.push("select search.refresh_all();");
out.push("commit;");

const supabaseDir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase");
writeFileSync(join(supabaseDir, "seed.sql"), out.join("\n") + "\n");

// image_url holds the object path inside the "product-images" bucket.
const imageDir = join(supabaseDir, "images", "products");
rmSync(imageDir, { recursive: true, force: true });
mkdirSync(imageDir, { recursive: true });
for (const p of products) writeFileSync(join(imageDir, p.image_url), productSvg(p.art));

console.log(`${products.length} images in supabase/images/products, seed.sql: ${brands.length} brands, ${categories.length} categories, ${products.length} products, ${variants.length} variants, ${attributes.length} attributes`);
