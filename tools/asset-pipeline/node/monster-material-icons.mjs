#!/usr/bin/env node
/**
 * Draws the sea-monster materials' item pictures (docs/design/FLEET.md, F3): one per material and
 * level, `apps/web/src/assets/items/monster_<material>_<level>.svg`.
 *
 * Each material keeps its own shape (scale, tentacle, shell, bone, pearl); a level is told by its
 * halo and the numeral badge (bronze I, silver II, gold III), so the three levels of one material
 * read as the same thing grown rarer. Hand-written vector art, no external source.
 *
 *   node tools/asset-pipeline/node/monster-material-icons.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../../../apps/web/src/assets/items");

const LEVELS = [
  { level: 1, numeral: "I", badge: ["#e2a66a", "#9a5a2b"], ink: "#5a3216", halo: null },
  { level: 2, numeral: "II", badge: ["#eef3f8", "#8fa3b8"], ink: "#34475c", halo: ["#bfe3ff", "#5aa7e0"] },
  { level: 3, numeral: "III", badge: ["#fff1a8", "#d99a1e"], ink: "#6b4300", halo: ["#fff3b0", "#f0a41c"] }
];

/** Each material's drawing, centred in a 256 box, above a shadow. */
const MATERIALS = {
  // Thuồng luồng's scale: a shield of a scale with growth ridges.
  scale: {
    defs: '<linearGradient id="m" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#8ff0c4"/><stop offset=".55" stop-color="#2fa784"/><stop offset="1" stop-color="#16614f"/></linearGradient>',
    body:
      '<path d="M128 40c42 18 70 52 70 96 0 44-30 74-70 84-40-10-70-40-70-84 0-44 28-78 70-96z" fill="url(#m)" stroke="#0f4438" stroke-width="6" stroke-linejoin="round"/>' +
      '<g fill="none" stroke="#0f4438" stroke-width="4" stroke-linejoin="round" opacity=".5"><path d="M128 72c30 14 50 38 50 70 0 32-22 54-50 62-28-8-50-30-50-62 0-32 20-56 50-70z"/><path d="M128 104c18 9 30 23 30 42 0 20-13 33-30 38-17-5-30-18-30-38 0-19 12-33 30-42z"/></g>' +
      '<path d="M98 76c-12 12-20 28-22 46" stroke="#e8fff5" stroke-width="8" stroke-linecap="round" fill="none" opacity=".7"/>'
  },
  // The octopus's tentacle: a curl with a row of suckers.
  tentacle: {
    defs: '<linearGradient id="m" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#f3a6e0"/><stop offset=".6" stop-color="#b44a9c"/><stop offset="1" stop-color="#6e2263"/></linearGradient>',
    body:
      '<path d="M70 210c-6-50 10-104 50-132 34-24 82-20 96 10 12 26-4 56-34 58-22 2-34-16-26-30 6-10 20-10 24-2" fill="none" stroke="#4f1747" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M70 210c-6-50 10-104 50-132 34-24 82-20 96 10 12 26-4 56-34 58-22 2-34-16-26-30 6-10 20-10 24-2" fill="none" stroke="url(#m)" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<g fill="#ffd7f1" stroke="#7a2b6c" stroke-width="3"><circle cx="78" cy="186" r="8"/><circle cx="80" cy="154" r="8"/><circle cx="90" cy="124" r="7.5"/><circle cx="108" cy="98" r="7"/><circle cx="134" cy="80" r="7"/><circle cx="164" cy="74" r="6.5"/><circle cx="190" cy="84" r="6"/></g>' +
      '<path d="M96 92c14-14 30-22 48-24" stroke="#ffe6f6" stroke-width="6" stroke-linecap="round" fill="none" opacity=".6"/>'
  },
  // The rock crab's shell: a craggy carapace with its rim and spines.
  shell: {
    defs: '<linearGradient id="m" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#ffc08a"/><stop offset=".55" stop-color="#d0602e"/><stop offset="1" stop-color="#7e2f17"/></linearGradient>',
    body:
      '<path d="M40 150c4-48 42-86 88-86s84 38 88 86l-14 10-12-12-14 14-16-12-16 14-16-14-16 14-16-14-16 12-14-14-12 12z" fill="url(#m)" stroke="#5a2110" stroke-width="6" stroke-linejoin="round"/>' +
      '<path d="M54 158c10 26 40 46 74 46s64-20 74-46" fill="#a8461f" stroke="#5a2110" stroke-width="6" stroke-linejoin="round"/>' +
      '<g fill="#7e2f17" opacity=".55"><circle cx="98" cy="108" r="9"/><circle cx="150" cy="100" r="11"/><circle cx="126" cy="130" r="8"/><circle cx="176" cy="132" r="7"/><circle cx="80" cy="136" r="6"/></g>' +
      '<path d="M78 98c14-14 32-22 52-24" stroke="#ffe2c4" stroke-width="7" stroke-linecap="round" fill="none" opacity=".65"/>'
  },
  // The leviathan's bone: a heavy curved rib, knobbed at both ends.
  bone: {
    defs: '<linearGradient id="m" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#fffaf0"/><stop offset=".6" stop-color="#e3d3b1"/><stop offset="1" stop-color="#a8916a"/></linearGradient>',
    body:
      '<path d="M70 196c34-20 64-58 86-112" fill="none" stroke="#6f5b3c" stroke-width="54" stroke-linecap="round"/>' +
      '<path d="M70 196c34-20 64-58 86-112" fill="none" stroke="url(#m)" stroke-width="40" stroke-linecap="round"/>' +
      '<g fill="url(#m)" stroke="#6f5b3c" stroke-width="6"><circle cx="54" cy="190" r="26"/><circle cx="80" cy="214" r="24"/><circle cx="144" cy="58" r="26"/><circle cx="176" cy="78" r="24"/></g>' +
      '<path d="M96 170c20-18 38-42 52-72" stroke="#ffffff" stroke-width="6" stroke-linecap="round" fill="none" opacity=".7"/>'
  },
  // The fire jellyfish's pearl: a pearl with a flame burning inside it.
  pearl: {
    defs:
      '<radialGradient id="m" cx=".38" cy=".34" r=".7"><stop stop-color="#fff8ec"/><stop offset=".45" stop-color="#ffc49a"/><stop offset="1" stop-color="#d0532f"/></radialGradient>' +
      '<radialGradient id="f" cx=".5" cy=".7" r=".6"><stop stop-color="#fff3a0"/><stop offset=".6" stop-color="#ff9a2e"/><stop offset="1" stop-color="#e2462a" stop-opacity="0"/></radialGradient>',
    body:
      '<circle cx="128" cy="130" r="72" fill="url(#m)" stroke="#7f2b18" stroke-width="6"/>' +
      '<path d="M128 182c-22 0-34-16-30-36 4-16 18-22 18-40 14 10 18 22 16 32 8-4 12-12 12-20 14 14 18 30 14 42-4 14-14 22-30 22z" fill="url(#f)"/>' +
      '<ellipse cx="100" cy="98" rx="20" ry="13" fill="#ffffff" opacity=".75" transform="rotate(-30 100 98)"/>'
  }
};

function halo(level) {
  if (level.halo === null) return "";
  const [inner, outer] = level.halo;
  const rays =
    level.level === 3
      ? '<g fill="#fff6c8" opacity=".9"><path d="M40 52l6 14 14 6-14 6-6 14-6-14-14-6 14-6z"/><path d="M214 42l4 9 9 4-9 4-4 9-4-9-9-4 9-4z"/><path d="M220 168l4 9 9 4-9 4-4 9-4-9-9-4 9-4z"/></g>'
      : "";
  return (
    `<radialGradient id="h" cx=".5" cy=".5" r=".5"><stop offset=".55" stop-color="${inner}" stop-opacity=".9"/><stop offset="1" stop-color="${outer}" stop-opacity="0"/></radialGradient>` +
    `|<circle cx="128" cy="130" r="118" fill="url(#h)"/>${rays}`
  );
}

/**
 * The level's badge: a coin with the numeral drawn as bars and serifs (item art carries no <text>,
 * so it looks the same whatever fonts a device has).
 */
function badge(level) {
  const [light, dark] = level.badge;
  const bars = level.numeral.length;
  const barWidth = 7;
  const gap = 5;
  const width = bars * barWidth + (bars - 1) * gap;
  const left = 204 - width / 2;
  let numeral = "";
  for (let index = 0; index < bars; index += 1) numeral += `<rect x="${String(left + index * (barWidth + gap))}" y="191" width="${String(barWidth)}" height="26"/>`;
  numeral += `<rect x="${String(left - 4)}" y="188" width="${String(width + 8)}" height="5" rx="1"/><rect x="${String(left - 4)}" y="215" width="${String(width + 8)}" height="5" rx="1"/>`;
  return (
    `<linearGradient id="b" x1="0" x2="0" y1="0" y2="1"><stop stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient>` +
    `|<circle cx="204" cy="204" r="34" fill="url(#b)" stroke="${level.ink}" stroke-width="6"/>` +
    `<g fill="${level.ink}">${numeral}</g>`
  );
}

let written = 0;
for (const [material, art] of Object.entries(MATERIALS)) {
  for (const level of LEVELS) {
    const [haloDefs, haloBody] = halo(level).split("|");
    const [badgeDefs, badgeBody] = badge(level).split("|");
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">' +
      `<defs>${art.defs}${haloDefs ?? ""}${badgeDefs}</defs>` +
      (haloBody ?? "") +
      '<ellipse cx="128" cy="226" rx="74" ry="13" fill="#2b2118" opacity=".18"/>' +
      art.body +
      badgeBody +
      "</svg>\n";
    writeFileSync(join(out, `monster_${material}_${String(level.level)}.svg`), svg);
    written += 1;
  }
}
console.log(`wrote ${String(written)} monster material icons to ${out}`);
