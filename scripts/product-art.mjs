// Flat-vector product illustrations for the demo catalog.
// One SVG per product, drawn from its category, noun, pattern and colors,
// so the picture always matches the listing. Pure function: no randomness
// beyond a hash of the product id, so output is stable across runs.

const HEX = {
  red: "#c0392b", maroon: "#7b1e2b", black: "#2a2a2e", white: "#f7f7f5", "off white": "#efe9dc",
  "navy blue": "#1f2f57", blue: "#2f6fd1", "sky blue": "#8ec5ee", green: "#2e8b57", olive: "#6b6b2e",
  "bottle green": "#0f4d34", yellow: "#f2c230", mustard: "#c9a227", pink: "#e98aa8", peach: "#f4b393",
  orange: "#e67e22", purple: "#7d3c98", brown: "#7a4a2a", tan: "#c19a6b", beige: "#d9c8a9", gold: "#c8a24a",
  silver: "#b9bcc2", grey: "#8a8f98", cream: "#f3e7c9", wine: "#5e1a2e", teal: "#16807d", lavender: "#b9a6dc",
};
const GOLD = "#d4a93c";

// --- color helpers ------------------------------------------------------
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const shade = (h, t) => (t < 0 ? mix(h, "#000000", -t) : mix(h, "#ffffff", t));
const lum = (h) => { const [r, g, b] = rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
const colorOf = (name) => HEX[name?.toLowerCase()] ?? "#999999";

// --- patterns -------------------------------------------------------------
function patternKind(pattern) {
  const p = pattern.toLowerCase();
  if (p.includes("floral")) return "floral";
  if (p.includes("bandhani") || p.includes("tie dye")) return "bandhani";
  if (p.includes("paisley")) return "paisley";
  if (p.includes("stripe") || p.includes("ikat")) return "stripes";
  if (p.includes("check")) return "checks";
  if (p.includes("phulkari")) return "phulkari";
  if (p.includes("chikankari") || p.includes("pearl")) return "chikan";
  if (p.includes("mirror") || p.includes("sequin") || p.includes("beaded")) return "mirror";
  if (/zari|zardozi|gota|embroider|thread/.test(p)) return "sparkle";
  if (p.includes("print") || p.includes("painted")) return "dots";
  if (/self design|textured|woven|braided/.test(p)) return "texture";
  return "none";
}
const hasGoldBorder = (pattern) => /zari|zardozi|gota|temple|sequin|woven/i.test(pattern);

function patternDef(kind, main, accent) {
  const on = lum(main) > 0.6 ? shade(main, -0.45) : shade(main, 0.55);
  const a = accent ?? on;
  switch (kind) {
    case "floral":
      return `<pattern id="pt" width="34" height="34" patternUnits="userSpaceOnUse"><g fill="${a}" opacity=".75">${
        [0, 72, 144, 216, 288].map((d) => `<circle cx="${17 + 4.5 * Math.cos((d * Math.PI) / 180)}" cy="${17 + 4.5 * Math.sin((d * Math.PI) / 180)}" r="3"/>`).join("")
      }</g><circle cx="17" cy="17" r="2" fill="${GOLD}"/><circle cx="0" cy="0" r="1.6" fill="${a}" opacity=".6"/><circle cx="34" cy="34" r="1.6" fill="${a}" opacity=".6"/></pattern>`;
    case "dots":
      return `<pattern id="pt" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r="3" fill="${a}" opacity=".7"/><circle cx="16" cy="16" r="3" fill="${a}" opacity=".7"/></pattern>`;
    case "bandhani":
      return `<pattern id="pt" width="18" height="18" patternUnits="userSpaceOnUse"><g fill="#fff" opacity=".8"><circle cx="4" cy="4" r="1.4"/><circle cx="8" cy="4" r="1.4"/><circle cx="4" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="14" cy="14" r="1.2"/></g></pattern>`;
    case "paisley":
      return `<pattern id="pt" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M20 8c8 0 11 9 6 15-4 5-12 6-14 1 4 1 8-1 8-5s-4-6-6-4c0-4 2-7 6-7z" fill="${a}" opacity=".7"/></pattern>`;
    case "stripes":
      return `<pattern id="pt" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="18" fill="${a}" opacity=".55"/></pattern>`;
    case "checks":
      return `<pattern id="pt" width="28" height="28" patternUnits="userSpaceOnUse"><rect width="14" height="28" fill="${a}" opacity=".28"/><rect width="28" height="14" fill="${a}" opacity=".28"/></pattern>`;
    case "phulkari":
      return `<pattern id="pt" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M13 4l6 9-6 9-6-9z" fill="${GOLD}" opacity=".85"/><path d="M13 9l3 4-3 4-3-4z" fill="#e8553d"/></pattern>`;
    case "chikan":
      return `<pattern id="pt" width="24" height="24" patternUnits="userSpaceOnUse"><g fill="none" stroke="#fff" stroke-width="1.3" opacity=".8"><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></g></pattern>`;
    case "mirror":
      return `<pattern id="pt" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="13" cy="13" r="4" fill="#e9ecef" stroke="${GOLD}" stroke-width="1.5"/><circle cx="0" cy="0" r="2" fill="${GOLD}"/><circle cx="26" cy="26" r="2" fill="${GOLD}"/></pattern>`;
    case "sparkle":
      return `<pattern id="pt" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M14 6l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="${GOLD}" opacity=".8"/></pattern>`;
    case "texture":
      return `<pattern id="pt" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 8L8 0" stroke="${on}" stroke-width="1" opacity=".18"/></pattern>`;
    default:
      return "";
  }
}

// --- shapes -----------------------------------------------------------------
// Each shape returns { parts, details }. A part is a filled path that gets
// the fabric pattern, border bands (rects clipped to the path) and shading.
// `c` = { main, accent, border, dark }.

function kurta(c, { hem = 392, pants = null, dupatta = false, scale = 1 } = {}) {
  const parts = [];
  if (pants) {
    parts.push({ d: `M150 ${hem - 30}L148 410L190 410L200 ${hem}L210 410L252 410L250 ${hem - 30}Z`, fill: pants, pattern: false });
  }
  parts.push({
    d: `M172 58Q200 84 228 58L290 74L352 168L322 186L286 122L298 ${hem}Q200 ${hem + 16} 102 ${hem}L114 122L78 186L48 168L110 74Z`,
    borders: [[0, hem - 26, 400, 18]],
  });
  let details = `<path d="M200 70V160" stroke="${c.dark}" stroke-width="3"/>` +
    [92, 114, 136].map((y) => `<circle cx="200" cy="${y}" r="3.2" fill="${c.border}"/>`).join("") +
    `<path d="M172 58Q200 84 228 58" fill="none" stroke="${c.border}" stroke-width="6"/>`;
  if (dupatta) {
    details += `<path d="M110 74Q180 150 290 330L310 300Q210 140 140 70Z" fill="${c.accent}" opacity=".8"/>` +
      `<path d="M290 330L310 300" stroke="${GOLD}" stroke-width="8"/>`;
  }
  return { parts, details, scale };
}

function sherwani(c) {
  const parts = [
    { d: "M100 82L68 96L54 300L86 306L106 150Z" },
    { d: "M300 82L332 96L346 300L314 306L294 150Z" },
    { d: "M168 56L232 56L300 82L312 398L88 398L100 82Z", borders: [[0, 372, 400, 26], [194, 56, 12, 342]] },
  ];
  const details = `<rect x="168" y="40" width="64" height="22" rx="6" fill="${c.main}" stroke="${c.dark}" stroke-width="2.5"/>` +
    `<rect x="168" y="40" width="64" height="8" rx="3" fill="${c.border}"/>` +
    [92, 130, 168, 206, 244, 282, 320].map((y) => `<circle cx="200" cy="${y}" r="5" fill="${GOLD}" stroke="${shade(GOLD, -0.3)}"/>`).join("") +
    `<rect x="54" y="286" width="32" height="12" fill="${c.border}" transform="rotate(2 70 292)"/>` +
    `<rect x="314" y="286" width="32" height="12" fill="${c.border}" transform="rotate(-2 330 292)"/>`;
  return { parts, details };
}

function nehruJacket(c) {
  const parts = [{
    d: "M160 60L240 60L292 86L282 150Q262 160 268 204L284 384L116 384L132 204Q138 160 118 150L108 86Z",
    borders: [[0, 370, 400, 14]],
  }];
  const details = `<rect x="164" y="44" width="72" height="22" rx="6" fill="${c.main}" stroke="${c.dark}" stroke-width="2.5"/>` +
    `<path d="M200 64V384" stroke="${c.dark}" stroke-width="2.5"/>` +
    [100, 150, 200, 250, 300].map((y) => `<circle cx="206" cy="${y}" r="4.5" fill="${c.border}"/>`).join("") +
    `<path d="M140 230h34M226 230h34M226 150h28" stroke="${c.dark}" stroke-width="4" stroke-linecap="round"/>`;
  return { parts, details };
}

function shirt(c, mandarin) {
  const parts = [{
    d: "M168 60Q200 76 232 60L292 78L344 166L314 184L282 132L288 370Q200 384 112 370L118 132L86 184L56 166L108 78Z",
  }];
  const collar = mandarin
    ? `<rect x="166" y="46" width="68" height="20" rx="6" fill="${c.main}" stroke="${c.dark}" stroke-width="2.5"/>`
    : `<path d="M168 60L200 98L232 60L216 46L184 46Z" fill="${shade(c.main, -0.08)}" stroke="${c.dark}" stroke-width="2.5"/>`;
  const details = collar + `<path d="M200 98V372" stroke="${c.dark}" stroke-width="2"/>` +
    [130, 175, 220, 265, 310].map((y) => `<circle cx="207" cy="${y}" r="3" fill="${c.dark}"/>`).join("") +
    `<rect x="132" y="150" width="40" height="44" rx="4" fill="none" stroke="${c.dark}" stroke-width="2"/>`;
  return { parts, details };
}

function saree(c) {
  const parts = [
    { d: "M84 108H322Q330 108 330 116V330H84Z", fill: shade(c.main, -0.15), pattern: false },
    { d: "M68 140H318Q332 140 332 154V364H82Q68 364 68 350Z", borders: [[68, 334, 264, 30], [304, 140, 28, 224]] },
    { d: "M332 140V262L214 140Z", fill: c.accent, borders: [[300, 140, 40, 130]] },
  ];
  const details = `<path d="M68 334H332" stroke="${shade(c.border, -0.25)}" stroke-width="2"/>` +
    `<path d="M68 348H332" stroke="${shade(c.border, 0.3)}" stroke-width="1.5" stroke-dasharray="6 5"/>` +
    `<path d="M332 140L214 140" stroke="${shade(c.border, -0.2)}" stroke-width="3"/>`;
  return { parts, details };
}

function dupatta(c, fringe) {
  const parts = [
    { d: "M112 84H196L190 382Q152 394 116 382Z", borders: [[0, 352, 400, 30]] },
    { d: "M184 84H286L294 352Q248 368 202 352Z", fill: shade(c.main, -0.1), borders: [[0, 322, 400, 30]] },
  ];
  const tassel = (x, y) => fringe
    ? `<path d="M${x} ${y}v14" stroke="${c.border}" stroke-width="2.5"/>`
    : `<path d="M${x} ${y}v10" stroke="${c.border}" stroke-width="2"/><circle cx="${x}" cy="${y + 13}" r="3.5" fill="${c.border}"/>`;
  let details = `<rect x="88" y="70" width="224" height="16" rx="8" fill="#8a6a45"/>`;
  for (let x = 122; x <= 186; x += fringe ? 7 : 16) details += tassel(x, 386);
  for (let x = 210; x <= 288; x += fringe ? 7 : 16) details += tassel(x, 356);
  return { parts, details };
}

function lehenga(c, scale = 1) {
  const parts = [
    { d: "M150 150Q200 162 250 150L330 384Q200 420 70 384Z", borders: [[0, 352, 400, 50]] },
    { d: "M162 66Q200 86 238 66L268 80L288 116L268 124L258 112L254 142Q200 152 146 142L142 112L132 124L112 116L132 80Z", fill: c.accent },
  ];
  let details = `<path d="M150 150Q200 162 250 150" fill="none" stroke="${c.border}" stroke-width="8"/>`;
  for (const x of [120, 160, 200, 240, 280]) details += `<path d="M${200 + (x - 200) * 0.3} 160L${x} 392" stroke="${c.dark}" stroke-width="1.5" opacity=".35"/>`;
  details += `<path d="M70 384Q200 420 330 384" fill="none" stroke="${shade(c.border, -0.25)}" stroke-width="3"/>`;
  return { parts, details, scale };
}

function shoeSide(c, { kind }) {
  // kind: jutti | mojari | oxford | sneaker
  const shapes = {
    jutti: { upper: "M92 326L96 286Q102 270 122 274Q150 282 176 270Q240 246 300 280Q336 300 352 316Q350 328 330 328Z", sole: "M86 326H340Q356 326 352 316L356 322Q352 340 334 340H96Q84 340 86 326Z" },
    mojari: { upper: "M92 326L96 286Q102 270 122 274Q150 282 176 270Q240 246 300 280Q330 296 346 302Q362 300 366 284Q376 298 360 316Q350 328 330 328Z", sole: "M86 326H340Q362 322 360 316L362 322Q356 340 334 340H96Q84 340 86 326Z" },
    oxford: { upper: "M88 318L90 262Q96 246 122 248L166 250Q214 236 262 260Q330 282 350 300Q358 316 340 318Z", sole: "M84 318H344Q358 318 354 330Q350 338 336 338H120L118 346H88Q82 346 84 336Z" },
    sneaker: { upper: "M82 318L82 250Q86 214 130 210L168 206Q200 172 242 192L302 238Q352 254 354 294L352 318Z", sole: "M72 318H362Q368 346 340 352H86Q64 348 72 318Z" },
  }[kind];
  const back = { d: shapes.upper, fill: shade(c.main, -0.22), pattern: false, transform: "translate(-34 -34) scale(.98)" };
  const backSole = { d: shapes.sole, fill: shade(kind === "sneaker" ? "#f4f4f2" : c.sole, -0.2), pattern: false, transform: "translate(-34 -34) scale(.98)" };
  const upper = { d: shapes.upper, borders: kind === "jutti" || kind === "mojari" ? [[0, 260, 400, 0]] : [] };
  const sole = { d: shapes.sole, fill: kind === "sneaker" ? "#f4f4f2" : c.sole, pattern: false };
  let details = "";
  if (kind === "sneaker") {
    details += `<path d="M110 286Q200 300 300 252" fill="none" stroke="${c.accent}" stroke-width="12" stroke-linecap="round"/>` +
      `<path d="M72 330H362" stroke="${c.accent}" stroke-width="5" opacity=".8"/>` +
      [0, 1, 2, 3].map((i) => `<path d="M${180 + i * 18} ${206 + i * 12}l16 -10" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`).join("") +
      `<path d="M82 250Q96 236 118 240" fill="none" stroke="${c.dark}" stroke-width="3"/>`;
  } else if (kind === "oxford") {
    details += `<path d="M166 250Q190 290 262 260" fill="none" stroke="${c.dark}" stroke-width="2.5"/>` +
      [0, 1, 2].map((i) => `<path d="M${186 + i * 14} ${252 + i * 2}l10 8" stroke="${c.dark}" stroke-width="2.5"/>`).join("") +
      `<path d="M276 266Q300 300 344 302" fill="none" stroke="${c.dark}" ${c.brogue ? 'stroke-width="4" stroke-dasharray="2 5" stroke-linecap="round"' : 'stroke-width="2"'}/>`;
  } else {
    details += `<path d="M122 274Q150 282 176 270" fill="none" stroke="${c.border}" stroke-width="4"/>` +
      `<path d="M200 268Q250 262 300 286" fill="none" stroke="${GOLD}" stroke-width="3" stroke-dasharray="5 4"/>`;
  }
  return { parts: [back, backSole, upper, sole], details };
}

function sandal(c, noun) {
  const n = noun.toLowerCase();
  const heel = n.includes("block") ? "M92 290H132L128 360H98Z" : n.includes("wedge") ? "M84 296Q90 360 100 360H200Q170 330 160 300Z" : null;
  const footbed = heel ? "M84 296Q120 280 170 300Q240 330 330 330Q356 330 354 344H230Q160 340 96 304Z" : "M80 330Q80 318 100 318H330Q356 318 354 336Q350 346 330 346H100Q80 346 80 330Z";
  const parts = [
    ...(heel ? [{ d: heel, fill: c.sole, pattern: false }] : []),
    { d: footbed, fill: c.sole, pattern: false },
  ];
  const y = heel ? 0 : 20;
  const strap = (d, w) => `<path d="${d}" fill="none" stroke="${c.dark}" stroke-width="${w + 5}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${c.main}" stroke-width="${w}" stroke-linecap="round"/>`;
  let details = strap(`M236 ${318 + y}Q264 ${254 + y} 304 ${326 + y}`, 24) + strap(`M146 ${302 + y}Q172 ${240 + y} 210 ${314 + y}`, 18);
  if (heel) details += strap("M108 296Q118 248 152 260", 10);
  if (/embellish|metallic|beaded/i.test(c.pattern)) details += `<circle cx="272" cy="${276 + y}" r="9" fill="#e9ecef" stroke="${GOLD}" stroke-width="2.5"/>`;
  return { parts, details, scale: 1.2 };
}

function kolhapuri(c) {
  const sole = (dx, r) => `M${200 + dx} 74C${250 + dx} 74 ${256 + dx} 150 ${250 + dx} 220C${246 + dx} 290 ${260 + dx} 330 ${246 + dx} 380C${236 + dx} 410 ${164 + dx} 410 ${154 + dx} 380C${140 + dx} 330 ${154 + dx} 290 ${150 + dx} 220C${146 + dx} 150 ${150 + dx} 74 ${200 + dx} 74Z`;
  const parts = [
    { d: sole(-62), fill: c.sole, pattern: false, transform: "rotate(-6 138 240)" },
    { d: sole(62), fill: c.sole, pattern: false, transform: "rotate(6 262 240)" },
  ];
  const strap = (dx, rot) => `<g transform="rotate(${rot} ${200 + dx} 240)">` +
    `<rect x="${146 + dx}" y="188" width="108" height="40" rx="18" fill="${c.main}" stroke="${c.dark}" stroke-width="2.5"/>` +
    `<path d="M${152 + dx} 208H${248 + dx}" stroke="${c.border}" stroke-width="4" stroke-dasharray="7 5"/>` +
    `<path d="M${200 + dx} 188V112" stroke="${c.main}" stroke-width="8"/><circle cx="${200 + dx}" cy="104" r="10" fill="none" stroke="${c.main}" stroke-width="6"/></g>`;
  return { parts, details: strap(-62, -6) + strap(62, 6) };
}

function potli(c, noun) {
  if (/clutch/i.test(noun)) {
    const parts = [{ d: "M78 160Q78 140 98 140H302Q322 140 322 160V320Q322 340 302 340H98Q78 340 78 320Z", borders: [[78, 140, 244, 22], [78, 318, 244, 22]] }];
    const details = `<path d="M180 140Q200 112 220 140" fill="none" stroke="${GOLD}" stroke-width="8"/>` +
      `<circle cx="200" cy="140" r="9" fill="${GOLD}" stroke="${shade(GOLD, -0.3)}" stroke-width="2"/>`;
    return { parts, details };
  }
  const parts = [
    { d: "M144 172Q96 232 108 316Q120 394 200 398Q280 394 292 316Q304 232 256 172Z", borders: [[0, 330, 400, 24]] },
    { d: "M142 172Q130 150 150 136Q175 150 200 136Q225 150 250 136Q270 150 258 172Z", fill: c.accent },
  ];
  const details = `<path d="M150 176Q200 190 250 176" fill="none" stroke="${GOLD}" stroke-width="7"/>` +
    `<path d="M168 150Q160 60 200 56Q240 60 232 150" fill="none" stroke="${GOLD}" stroke-width="4"/>` +
    `<path d="M150 186L140 250M250 186L262 250" stroke="${GOLD}" stroke-width="3"/>` +
    `<circle cx="140" cy="256" r="6" fill="${c.accent}" stroke="${GOLD}" stroke-width="2"/><circle cx="262" cy="256" r="6" fill="${c.accent}" stroke="${GOLD}" stroke-width="2"/>`;
  return { parts, details };
}

function shapeFor(p, c) {
  const n = p.noun.toLowerCase();
  switch (p.cat) {
    case "Kurtas":
      if (n.includes("pyjama")) return kurta(c, { hem: 340, pants: c.pants });
      if (n.includes("short")) return kurta(c, { hem: 330 });
      return kurta(c, { hem: p.gender === "women" && !n.includes("kurti") ? 396 : 370 });
    case "Kurta Sets": return kurta(c, { hem: 330, pants: c.accent, dupatta: n.includes("dupatta") });
    case "Boys Ethnic Wear":
      if (n.includes("sherwani")) return { ...sherwani(c), scale: 0.86 };
      if (n.includes("nehru")) return { ...nehruJacket(c), scale: 0.86 };
      return kurta(c, { hem: 330, pants: c.pants, scale: 0.86 });
    case "Sherwanis": return sherwani(c);
    case "Nehru Jackets": return nehruJacket(c);
    case "Shirts": return shirt(c, n.includes("mandarin") || n.includes("kurta"));
    case "Sarees": return saree(c);
    case "Dupattas": return dupatta(c, false);
    case "Stoles & Shawls": return dupatta(c, true);
    case "Lehengas": return lehenga(c);
    case "Girls Ethnic Wear": return lehenga(c, 0.86);
    case "Juttis": return shoeSide(c, { kind: "jutti" });
    case "Mojaris": return shoeSide(c, { kind: "mojari" });
    case "Sneakers": return shoeSide(c, { kind: "sneaker" });
    case "Formal Shoes": return shoeSide(c, { kind: "oxford" });
    case "Sandals": return sandal(c, p.noun);
    case "Kolhapuris": return kolhapuri(c);
    case "Potli Bags": return potli(c, p.noun);
    default: return kurta(c);
  }
}

// --- render -------------------------------------------------------------
export function productSvg(p) {
  const main = colorOf(p.colors[0]);
  const second = p.colors[1] ? colorOf(p.colors[1]) : null;
  const accent = second ?? (lum(main) > 0.55 ? shade(main, -0.35) : shade(main, 0.35));
  const kind = patternKind(p.pattern);
  const c = {
    main, accent,
    border: hasGoldBorder(p.pattern) ? GOLD : (second ?? shade(main, -0.3)),
    dark: shade(main, lum(main) > 0.85 ? -0.35 : -0.42),
    pants: lum(main) > 0.75 ? "#e8e1d3" : "#f3efe6",
    sole: /leather|suede/i.test(p.material ?? "") && lum(main) > 0.7 ? "#a57a4f" : shade(main, -0.25),
    brogue: /brogue/i.test(p.pattern + p.noun),
    pattern: p.pattern,
  };
  if (["Kolhapuris", "Sandals"].includes(p.cat)) c.sole = /white|cream|beige|off white|silver/i.test(p.colors[0]) ? "#b98a5c" : "#8b5a32";
  if (["Juttis", "Mojaris", "Formal Shoes"].includes(p.cat)) c.sole = "#5a3b22";

  const bg = mix("#f5f1ea", main, 0.13);
  const { parts, details, scale = 1 } = shapeFor(p, c);
  const pat = patternDef(kind, main, second && kind !== "texture" ? second : null);
  const fabric = (part) => (part.fill ?? main);

  let body = "";
  parts.forEach((part, i) => {
    const tf = part.transform ? ` transform="${part.transform}"` : "";
    const fill = fabric(part);
    const outline = shade(fill, lum(fill) > 0.85 ? -0.35 : -0.42);
    const inner = [
      part.pattern !== false && pat ? `<rect width="400" height="450" fill="url(#pt)"/>` : "",
      ...(part.borders ?? []).filter((b) => b[3] > 0).map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c.border}"/>` +
        (c.border === GOLD ? `<rect x="${x}" y="${y + h / 2 - 1}" width="${w}" height="2" fill="${shade(GOLD, -0.3)}"/>` : "")),
      `<rect width="400" height="450" fill="url(#sh)"/>`,
    ].join("");
    body += `<g${tf}><clipPath id="c${i}"><path d="${part.d}"/></clipPath>` +
      `<path d="${part.d}" fill="${fill}"/><g clip-path="url(#c${i})">${inner}</g>` +
      `<path d="${part.d}" fill="none" stroke="${outline}" stroke-width="2.5" stroke-linejoin="round"/></g>`;
  });

  const wrap = scale === 1 ? body + details : `<g transform="translate(${200 * (1 - scale)} ${410 * (1 - scale)}) scale(${scale})">${body}${details}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 450" width="400" height="450">` +
    `<defs>${pat}<linearGradient id="sh" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/>` +
    `<stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".14"/></linearGradient></defs>` +
    `<rect width="400" height="450" fill="${bg}"/><ellipse cx="200" cy="412" rx="140" ry="13" fill="#000" opacity=".07"/>` +
    wrap + `</svg>`;
}
