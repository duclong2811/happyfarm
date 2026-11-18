import { generateHomeIsland, generateIsland, type GeneratedIsland, type IslandCellKind, type IslandElement, type IslandOutline } from "@happy-farm/game-data";
import type { GetWorldChartResponse, SeaRegionDTO } from "@happy-farm/contracts";

/**
 * The world map, drawn as an old sea chart (docs/design/WORLD_MAP.md): parchment, a wind rose at the
 * Centre with rhumb lines across the sea, the four seas lettered in a period hand, every open
 * archipelago with its islands - a player's island in its own colours, a wild one in sepia ink - and
 * fog over the waters nobody has charted yet. Everything is drawn by this code; no historical chart
 * or other game's map is copied.
 *
 * The geometry (fitting the chart, free places, the default region, names) is pure and tested; the
 * drawing only paints what those helpers decide.
 */

export const SEA_REGION_ORDER: readonly SeaRegionDTO[] = ["NORTH", "EAST", "SOUTH", "WEST"];

/** Proper names of each sea's archipelagos, in opening order. Names, so they are not translated. */
export const ARCHIPELAGO_NAMES: Readonly<Record<SeaRegionDTO, readonly string[]>> = {
  NORTH: ["Sương Mù", "Hải Âu", "Gió Bấc", "Băng Tuyết", "Sao Bắc Đẩu", "Cá Voi", "Đá Xám", "Mây Bạc", "Lạc Đà Biển", "Hải Cẩu", "Trăng Lạnh", "Sóng Bạc"],
  EAST: ["Bình Minh", "Ngọc Trai", "Rồng Xanh", "Mặt Trời Mọc", "Trúc Xanh", "San Hô", "Hoa Đào", "Tơ Liễu", "Chim Én", "Lá Phong", "Suối Vàng", "Phượng Hoàng"],
  SOUTH: ["Hoàng Hôn", "Lửa Đỏ", "Rùa Biển", "Dừa Xiêm", "Nắng Vàng", "Hỏa Diệm", "Cát Trắng", "Chim Bói Cá", "Mãng Cầu", "Cá Heo", "Ngọn Hải Đăng", "Đuôi Công"],
  WEST: ["Trăng Non", "Đá Đen", "Gió Tây", "Thiết Sơn", "Sư Tử Biển", "Hải Tặc", "Kim Cương", "Núi Bạc", "Đại Bàng", "Mỏ Ngọc", "Chuông Đồng", "Sao Hôm"]
};

export function archipelagoName(region: SeaRegionDTO, index: number): string {
  return ARCHIPELAGO_NAMES[region][index - 1] ?? `${region} ${String(index)}`;
}

/** Free places in each sea's open archipelagos. */
export function freePlaces(chart: GetWorldChartResponse): Readonly<Record<SeaRegionDTO, number>> {
  const counts: Record<SeaRegionDTO, number> = { NORTH: 0, EAST: 0, SOUTH: 0, WEST: 0 };
  for (const entry of chart.regions) {
    counts[entry.region] = entry.archipelagos.reduce((sum, archipelago) => sum + archipelago.slots.filter((slot) => !slot.claimed).length, 0);
  }
  return counts;
}

/** The sea a newcomer is offered first: the one with the most free places, in chart order on a tie. */
export function suggestedRegion(chart: GetWorldChartResponse): SeaRegionDTO {
  const counts = freePlaces(chart);
  let best: SeaRegionDTO = "NORTH";
  for (const region of SEA_REGION_ORDER) if (counts[region] > counts[best]) best = region;
  return best;
}

export interface ChartFrame {
  /** Chart tiles to canvas pixels. */
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** Fits every open archipelago and the Centre into a canvas, with room for lettering round the edge. */
export function fitChart(chart: GetWorldChartResponse, width: number, height: number, margin = 0.16): ChartFrame {
  let minX = -700;
  let maxX = 700;
  let minZ = -700;
  let maxZ = 700;
  for (const entry of chart.regions) {
    for (const archipelago of entry.archipelagos) {
      for (const slot of archipelago.slots) {
        minX = Math.min(minX, slot.x - 160);
        maxX = Math.max(maxX, slot.x + 160);
        minZ = Math.min(minZ, slot.z - 160);
        maxZ = Math.max(maxZ, slot.z + 160);
      }
    }
  }
  // Keep the Centre in the middle, so the wind rose sits where the chart's eye goes first.
  const half = Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minZ), Math.abs(maxZ));
  const usable = Math.min(width, height) * (1 - margin * 2);
  const scale = usable / (half * 2);
  return { scale, offsetX: width / 2, offsetY: height / 2 };
}

export function toCanvas(frame: ChartFrame, x: number, z: number): { readonly x: number; readonly y: number } {
  return { x: frame.offsetX + x * frame.scale, y: frame.offsetY + z * frame.scale };
}

/** The slot under a canvas point, if any (for a click on the chart). */
export function slotAt(chart: GetWorldChartResponse, frame: ChartFrame, px: number, py: number, radius: number): { readonly region: SeaRegionDTO; readonly slotId: string } | null {
  let best: { region: SeaRegionDTO; slotId: string; d: number } | null = null;
  for (const entry of chart.regions) {
    for (const archipelago of entry.archipelagos) {
      for (const slot of archipelago.slots) {
        const at = toCanvas(frame, slot.x, slot.z);
        const d = Math.hypot(at.x - px, at.y - py);
        if (d <= radius && (best === null || d < best.d)) best = { region: entry.region, slotId: slot.slotId, d };
      }
    }
  }
  return best === null ? null : { region: best.region, slotId: best.slotId };
}

/** The sea a canvas point lies in: by its bearing from the Centre. */
export function regionAt(frame: ChartFrame, px: number, py: number): SeaRegionDTO {
  const dx = px - frame.offsetX;
  const dy = py - frame.offsetY;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "EAST" : "WEST";
  return dy > 0 ? "SOUTH" : "NORTH";
}

export interface ChartDrawOptions {
  readonly translate: (key: string, params?: Readonly<Record<string, string | number>>) => string;
  /** The sea a newcomer is choosing: lit, the others dimmed. */
  readonly selectedRegion?: SeaRegionDTO | null;
  /** Smaller lettering and no doodles, for the picker's thumbnail. */
  readonly compact?: boolean;
}

const INK = "#3b2a1a";
const INK_SOFT = "rgba(59, 42, 26, 0.55)";
const RHUMB_PRIMARY = "rgba(59, 42, 26, 0.42)";
const RHUMB_HALF = "rgba(62, 110, 66, 0.4)";
const RHUMB_QUARTER = "rgba(168, 64, 44, 0.36)";
const SEA_TINT = "rgba(96, 140, 150, 0.18)";

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawParchment(context: CanvasRenderingContext2D, width: number, height: number): void {
  const base = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.1, width / 2, height / 2, Math.max(width, height) * 0.72);
  base.addColorStop(0, "#f1e2bd");
  base.addColorStop(0.65, "#e6cf9c");
  base.addColorStop(1, "#c9a66b");
  context.fillStyle = base;
  context.fillRect(0, 0, width, height);
  // Age: speckles and a few soft stains, the same on every visit.
  const roll = seeded(1652);
  for (let i = 0; i < (width * height) / 900; i += 1) {
    context.fillStyle = `rgba(110, 76, 40, ${String(0.04 + roll() * 0.06)})`;
    context.fillRect(roll() * width, roll() * height, 1 + roll() * 1.5, 1 + roll() * 1.5);
  }
  for (let i = 0; i < 6; i += 1) {
    const x = roll() * width;
    const y = roll() * height;
    const r = (0.05 + roll() * 0.12) * Math.min(width, height);
    const stain = context.createRadialGradient(x, y, r * 0.2, x, y, r);
    stain.addColorStop(0, "rgba(160, 118, 60, 0.10)");
    stain.addColorStop(1, "rgba(160, 118, 60, 0)");
    context.fillStyle = stain;
    context.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** Thirty-two rhumb lines from the rose: the eight winds in ink, half-winds green, quarter-winds red. */
function drawRhumbLines(context: CanvasRenderingContext2D, cx: number, cy: number, reach: number): void {
  for (let i = 0; i < 32; i += 1) {
    const angle = (i / 32) * Math.PI * 2 - Math.PI / 2;
    context.strokeStyle = i % 4 === 0 ? RHUMB_PRIMARY : i % 2 === 0 ? RHUMB_HALF : RHUMB_QUARTER;
    context.lineWidth = i % 4 === 0 ? 1.1 : 0.8;
    context.beginPath();
    context.moveTo(cx, cy);
    context.lineTo(cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach);
    context.stroke();
  }
}

/** A sixteen-point wind rose: long cardinal points, shorter ones between, each point half dark, half light. */
function drawWindRose(context: CanvasRenderingContext2D, cx: number, cy: number, size: number, north: string): void {
  context.save();
  context.translate(cx, cy);
  context.strokeStyle = INK;
  context.lineWidth = 1;
  for (const [ring, width] of [[size * 1.08, 1.4], [size * 0.98, 0.7], [size * 0.42, 0.8]] as const) {
    context.lineWidth = width;
    context.beginPath();
    context.arc(0, 0, ring, 0, Math.PI * 2);
    context.stroke();
  }
  for (let i = 0; i < 64; i += 1) {
    const angle = (i / 64) * Math.PI * 2;
    const inner = size * (i % 4 === 0 ? 0.9 : 0.94);
    context.beginPath();
    context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    context.lineTo(Math.cos(angle) * size * 0.98, Math.sin(angle) * size * 0.98);
    context.stroke();
  }
  const points = [
    { count: 16, length: 0.55, width: 0.07, dark: "#7a6a4f", light: "#efe0bd" },
    { count: 8, length: 0.72, width: 0.1, dark: "#3f6b45", light: "#d9e6c4" },
    { count: 4, length: 0.96, width: 0.14, dark: "#2c2015", light: "#f6ead0" }
  ];
  for (const layer of points) {
    for (let i = 0; i < layer.count; i += 1) {
      const angle = (i / layer.count) * Math.PI * 2 - Math.PI / 2 + (layer.count === 16 ? Math.PI / 16 : layer.count === 8 ? Math.PI / 8 : 0);
      const tipX = Math.cos(angle) * size * layer.length;
      const tipY = Math.sin(angle) * size * layer.length;
      const sideX = Math.cos(angle + Math.PI / 2) * size * layer.width;
      const sideY = Math.sin(angle + Math.PI / 2) * size * layer.width;
      context.fillStyle = layer.dark;
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(tipX, tipY);
      context.lineTo(sideX, sideY);
      context.closePath();
      context.fill();
      context.fillStyle = layer.light;
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(tipX, tipY);
      context.lineTo(-sideX, -sideY);
      context.closePath();
      context.fill();
      context.strokeStyle = INK;
      context.lineWidth = 0.6;
      context.beginPath();
      context.moveTo(sideX, sideY);
      context.lineTo(tipX, tipY);
      context.lineTo(-sideX, -sideY);
      context.stroke();
    }
  }
  context.fillStyle = "#a8402c";
  context.beginPath();
  context.arc(0, 0, size * 0.05, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = INK;
  context.font = `italic bold ${String(Math.round(Math.max(10, size * 0.3)))}px "Palatino Linotype", "Book Antiqua", Georgia, serif`;
  context.textAlign = "center";
  context.textBaseline = "bottom";
  context.fillText(north, 0, -size * 1.12);
  context.restore();
}

const islandCache = new Map<string, HTMLCanvasElement>();

/** Land as a chart-maker would wash it in: soft watercolour tints that sit on parchment. */
const CHART_LAND_TINTS: Readonly<Record<Exclude<IslandCellKind, "DEEP" | "SHALLOW">, readonly [number, number, number]>> = {
  SAND: [226, 200, 142],
  GRASS: [150, 180, 104],
  FOREST: [96, 136, 76],
  ROCK: [146, 132, 116],
  MEADOW: [184, 198, 120],
  FIELD: [198, 160, 104]
};
/** A wild island is drawn in sepia only: the place is known, nobody has settled it. */
const SEPIA_LAND: readonly [number, number, number] = [214, 186, 136];
const SEPIA_HIGH: readonly [number, number, number] = [176, 142, 96];
const COAST_INK: readonly [number, number, number] = [59, 42, 26];

function isLand(kind: IslandCellKind | undefined): boolean {
  return kind !== undefined && kind !== "DEEP" && kind !== "SHALLOW";
}

/**
 * One island as the chart draws it: its land washed in colour (a player's) or in sepia (a wild one),
 * a two-cell inked coastline so the shape still reads when the sprite is drawn small, and its sea
 * left clear for the parchment to show through.
 */
function islandSprite(template: { element: string; outline: string; seed: number; generatorVersion: number }, inked: boolean): HTMLCanvasElement | null {
  const key = `${template.element}:${template.outline}:${String(template.seed)}:${String(template.generatorVersion)}:${inked ? "ink" : "colour"}`;
  const cached = islandCache.get(key);
  if (cached !== undefined) return cached;
  if (typeof document === "undefined") return null;
  const element = template.element as IslandElement;
  const outline = template.outline as IslandOutline;
  let island: GeneratedIsland;
  try {
    island = template.generatorVersion === 1 ? generateIsland(element, template.seed, 96, outline) : generateHomeIsland(element, template.seed, 96, outline);
  } catch {
    return null;
  }
  const size = island.size;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context === null) return null;
  const image = context.createImageData(size, size);
  const cells = island.cells;
  const nearWater = (x: number, y: number): boolean => {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        if (Math.abs(dx) + Math.abs(dy) > 2) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size || !isLand(cells[ny * size + nx])) return true;
      }
    }
    return false;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      const kind = cells[index];
      let color: readonly [number, number, number];
      let alpha = 255;
      if (kind === undefined || kind === "DEEP") continue;
      if (kind === "SHALLOW") {
        color = inked ? [170, 168, 140] : [126, 186, 186];
        alpha = 70;
      } else if (nearWater(x, y)) {
        color = COAST_INK;
      } else if (inked) {
        color = kind === "ROCK" || kind === "FOREST" ? SEPIA_HIGH : SEPIA_LAND;
      } else {
        color = CHART_LAND_TINTS[kind];
      }
      image.data[index * 4] = color[0];
      image.data[index * 4 + 1] = color[1];
      image.data[index * 4 + 2] = color[2];
      image.data[index * 4 + 3] = alpha;
    }
  }
  context.putImageData(image, 0, 0);
  islandCache.set(key, canvas);
  return canvas;
}

function drawGalleon(context: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  context.save();
  context.translate(x, y);
  context.strokeStyle = INK;
  context.fillStyle = "rgba(122, 80, 44, 0.85)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(-size, 0);
  context.quadraticCurveTo(0, size * 0.45, size, 0);
  context.lineTo(size * 0.75, -size * 0.18);
  context.lineTo(-size * 0.8, -size * 0.18);
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = "rgba(247, 236, 210, 0.95)";
  for (const [mx, h] of [[-0.45, 0.95], [0.05, 1.25], [0.5, 0.85]] as const) {
    context.beginPath();
    context.moveTo(size * mx, -size * 0.18);
    context.lineTo(size * mx, -size * h);
    context.stroke();
    context.beginPath();
    context.moveTo(size * (mx - 0.28), -size * (h - 0.12));
    context.quadraticCurveTo(size * (mx + 0.1), -size * (h * 0.6), size * (mx - 0.26), -size * 0.32);
    context.lineTo(size * (mx + 0.24), -size * 0.32);
    context.quadraticCurveTo(size * (mx + 0.4), -size * (h * 0.6), size * (mx + 0.26), -size * (h - 0.12));
    context.closePath();
    context.fill();
    context.stroke();
  }
  context.restore();
}

function drawSerpent(context: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  context.save();
  context.translate(x, y);
  context.strokeStyle = INK;
  context.fillStyle = "rgba(76, 112, 80, 0.85)";
  context.lineWidth = 1;
  for (let i = 0; i < 3; i += 1) {
    const hx = -size + i * size * 0.8;
    context.beginPath();
    context.arc(hx, 0, size * 0.3, Math.PI, 0);
    context.fill();
    context.stroke();
  }
  context.beginPath();
  context.arc(size * 1.45, -size * 0.25, size * 0.22, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = INK;
  context.beginPath();
  context.arc(size * 1.52, -size * 0.3, size * 0.04, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawWaves(context: CanvasRenderingContext2D, width: number, height: number, avoid: (x: number, y: number) => boolean): void {
  const roll = seeded(7741);
  context.strokeStyle = "rgba(70, 92, 96, 0.35)";
  context.lineWidth = 1;
  for (let i = 0; i < 46; i += 1) {
    const x = roll() * width;
    const y = roll() * height;
    if (avoid(x, y)) continue;
    const w = 6 + roll() * 6;
    context.beginPath();
    context.moveTo(x - w, y);
    context.quadraticCurveTo(x - w / 2, y - 3, x, y);
    context.quadraticCurveTo(x + w / 2, y - 3, x + w, y);
    context.stroke();
  }
}

/** Paints the whole chart into `canvas` (at its own pixel size). */
export function drawSeaChart(canvas: HTMLCanvasElement, chart: GetWorldChartResponse, options: ChartDrawOptions): ChartFrame {
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const frame = fitChart(chart, width, height, options.compact === true ? 0.1 : 0.16);
  if (context === null) return frame;
  const t = options.translate;
  const compact = options.compact === true;
  const scaleText = Math.max(0.6, Math.min(width, height) / 900);

  drawParchment(context, width, height);
  context.fillStyle = SEA_TINT;
  context.fillRect(0, 0, width, height);
  drawRhumbLines(context, frame.offsetX, frame.offsetY, Math.hypot(width, height));

  // A soft light over the chosen sea's archipelagos, so a newcomer sees where they will land.
  const selected = chart.regions.find((entry) => entry.region === options.selectedRegion);
  for (const archipelago of selected?.archipelagos ?? []) {
    const at = toCanvas(frame, archipelago.centreX, archipelago.centreZ);
    const r = (compact ? 560 : 420) * frame.scale;
    const glow = context.createRadialGradient(at.x, at.y, r * 0.2, at.x, at.y, r);
    glow.addColorStop(0, compact ? "rgba(255, 226, 140, 0.85)" : "rgba(255, 236, 170, 0.55)");
    glow.addColorStop(1, "rgba(255, 236, 170, 0)");
    context.fillStyle = glow;
    context.fillRect(at.x - r, at.y - r, r * 2, r * 2);
  }

  // Islands, archipelago by archipelago.
  const islandPixels = Math.max(compact ? 20 : 16, 150 * frame.scale);
  for (const entry of chart.regions) {
    const dim = options.selectedRegion !== undefined && options.selectedRegion !== null && options.selectedRegion !== entry.region;
    for (const archipelago of entry.archipelagos) {
      const centre = toCanvas(frame, archipelago.centreX, archipelago.centreZ);
      context.globalAlpha = dim ? (compact ? 0.35 : 0.45) : 1;
      context.strokeStyle = INK_SOFT;
      context.setLineDash([3, 4]);
      context.lineWidth = 1;
      context.beginPath();
      context.arc(centre.x, centre.y, 330 * frame.scale, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
      for (const slot of archipelago.slots) {
        const at = toCanvas(frame, slot.x, slot.z);
        const sprite = islandSprite(slot.island, !slot.claimed);
        if (sprite !== null) context.drawImage(sprite, at.x - islandPixels / 2, at.y - islandPixels / 2, islandPixels, islandPixels);
        if (slot.mine) {
          context.strokeStyle = "#a8402c";
          context.lineWidth = 2;
          context.beginPath();
          context.arc(at.x, at.y, islandPixels * 0.62, 0, Math.PI * 2);
          context.stroke();
          // A little red pennant over the player's own island.
          context.fillStyle = "#c0392b";
          context.strokeStyle = INK;
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(at.x, at.y - islandPixels * 0.2);
          context.lineTo(at.x, at.y - islandPixels * 0.95);
          context.stroke();
          context.beginPath();
          context.moveTo(at.x, at.y - islandPixels * 0.95);
          context.lineTo(at.x + islandPixels * 0.42, at.y - islandPixels * 0.8);
          context.lineTo(at.x, at.y - islandPixels * 0.65);
          context.closePath();
          context.fill();
        }
      }
      if (!compact) {
        context.fillStyle = INK;
        context.font = `italic ${String(Math.round(13 * scaleText))}px "Palatino Linotype", "Book Antiqua", Georgia, serif`;
        context.textAlign = "center";
        context.textBaseline = "top";
        context.fillText(t("chart.archipelago", { name: archipelagoName(entry.region, archipelago.index) }), centre.x, centre.y + 345 * frame.scale);
      }
      context.globalAlpha = 1;
    }
  }

  // The seas' names, out past their archipelagos.
  const reach = Math.min(width, height) * 0.43;
  const directions: Readonly<Record<SeaRegionDTO, { x: number; y: number }>> = { NORTH: { x: 0, y: -1 }, EAST: { x: 1, y: 0 }, SOUTH: { x: 0, y: 1 }, WEST: { x: -1, y: 0 } };
  for (const region of SEA_REGION_ORDER) {
    const direction = directions[region];
    const lit = options.selectedRegion === region;
    context.fillStyle = lit ? "#7a2414" : INK;
    context.font = `italic ${lit ? "bold " : ""}${String(Math.round(compact ? Math.min(width, height) * 0.075 : 26 * scaleText))}px "Palatino Linotype", "Book Antiqua", Georgia, serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.save();
    context.translate(frame.offsetX + direction.x * reach, frame.offsetY + direction.y * reach);
    if (region === "EAST") context.rotate(Math.PI / 2);
    if (region === "WEST") context.rotate(-Math.PI / 2);
    context.fillText(t(`chart.region.${region}`), 0, 0);
    context.restore();
  }

  // The Centre: the wind rose, and the hub's name under it.
  // The rose sits in the Centre's open water: big enough to read, never over the first archipelagos.
  const roseSize = compact ? Math.max(12, 200 * frame.scale) : Math.max(24, Math.min(260 * frame.scale, Math.min(width, height) * 0.09));
  drawWindRose(context, frame.offsetX, frame.offsetY, roseSize, t("chart.northMark"));
  if (!compact) {
    context.fillStyle = INK;
    context.font = `bold ${String(Math.round(14 * scaleText))}px "Palatino Linotype", "Book Antiqua", Georgia, serif`;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText(t("chart.centre"), frame.offsetX, frame.offsetY + roseSize * 1.18);
  }

  if (!compact) {
    const near = (x: number, y: number): boolean => {
      for (const entry of chart.regions) for (const archipelago of entry.archipelagos) {
        const at = toCanvas(frame, archipelago.centreX, archipelago.centreZ);
        if (Math.hypot(at.x - x, at.y - y) < 380 * frame.scale) return true;
      }
      return Math.hypot(x - frame.offsetX, y - frame.offsetY) < roseSize * 1.5;
    };
    drawWaves(context, width, height, near);
    drawGalleon(context, width * 0.78, height * 0.22, 24 * scaleText);
    drawSerpent(context, width * 0.2, height * 0.8, 30 * scaleText);
  }

  // Fog over the uncharted waters, thickest at the edges, with the old warning lettered in it.
  const fog = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.38, width / 2, height / 2, Math.max(width, height) * 0.62);
  fog.addColorStop(0, "rgba(246, 240, 226, 0)");
  fog.addColorStop(1, "rgba(246, 240, 226, 0.78)");
  context.fillStyle = fog;
  context.fillRect(0, 0, width, height);
  if (!compact) {
    context.fillStyle = INK_SOFT;
    context.font = `italic ${String(Math.round(13 * scaleText))}px "Palatino Linotype", "Book Antiqua", Georgia, serif`;
    context.textAlign = "center";
    context.fillText(t("chart.unexplored"), width * 0.82, height * 0.92);
    context.fillText(t("chart.unexplored"), width * 0.16, height * 0.08);
  }

  // The frame: a double rule, as a chart's border.
  context.strokeStyle = INK;
  context.lineWidth = 2;
  context.strokeRect(6, 6, width - 12, height - 12);
  context.lineWidth = 0.8;
  context.strokeRect(11, 11, width - 22, height - 22);
  return frame;
}
