// Small pure helpers shared across modules.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Create an element with props + children. */
export function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return node;
}

/** Format a (possibly negative = BCE) year for display. */
export function fmtYear(y) {
  if (y == null) return '?';
  return y < 0 ? `${-y} BCE` : `${y}`;
}

/** Strip diacritics + lowercase for fuzzy matching. */
export function normalize(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const R = 6371; // km
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversine(aLat, aLng, bLat, bLng) {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from A to B, in degrees (0 = north). */
export function bearing(aLat, aLng, bLat, bLng) {
  const y = Math.sin(rad(bLng - aLng)) * Math.cos(rad(bLat));
  const x =
    Math.cos(rad(aLat)) * Math.sin(rad(bLat)) -
    Math.sin(rad(aLat)) * Math.cos(rad(bLat)) * Math.cos(rad(bLng - aLng));
  return (Math.atan2(y, x) * 180) / Math.PI;
}

const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
/** Compass arrow glyph for a bearing. */
export function arrowFor(deg) {
  const i = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return ARROWS[i];
}

export function fmtKm(km) {
  if (km < 1) return '0 km';
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString()} km`;
}

/** Deterministic 32-bit hash of a string. */
export function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 seeded PRNG -> function returning [0,1). */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle using a provided rng; returns a new array. */
export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Today's date key in UTC (YYYY-MM-DD). */
export function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Rate how hard a figure is to guess, from three signals:
 *  - recognizability  (rank in the pageviews-sorted list; lower = more famous)
 *  - missing info     (no death pin = only half the map to reason from)
 *  - era              (ancient / pre-modern figures are less familiar)
 * Returns { tier, level (0..3), reasons[] }.
 */
const DIFF_TIERS = ['easy', 'medium', 'hard', 'expert'];
export function computeDifficulty(f, rank) {
  let score = 0;
  const reasons = [];
  if (rank >= 500) { score += 3; reasons.push('niche fame'); }
  else if (rank >= 260) { score += 2; }
  else if (rank >= 110) { score += 1; }
  if (f.deathLat == null) {
    score += 1;
    reasons.push(f.deathYear == null ? 'still living' : 'death place unknown');
  }
  if (f.birthYear < 0) { score += 2; reasons.push('ancient era'); }
  else if (f.birthYear < 1500) { score += 1; reasons.push('pre-modern'); }
  const level = score <= 1 ? 0 : score === 2 ? 1 : score === 3 ? 2 : 3;
  return { tier: DIFF_TIERS[level], level, reasons };
}

/** Heat label + 0..1 closeness for a birthplace-distance (km). */
export function heatFor(km) {
  const closeness = Math.max(0, 1 - Math.sqrt(km / 12000));
  let label, key;
  if (km < 150) { label = 'Boiling'; key = 'hot'; }
  else if (km < 600) { label = 'Hot'; key = 'hot'; }
  else if (km < 2000) { label = 'Warm'; key = 'warm'; }
  else if (km < 5000) { label = 'Cool'; key = 'cool'; }
  else { label = 'Cold'; key = 'cold'; }
  return { label, key, closeness };
}
