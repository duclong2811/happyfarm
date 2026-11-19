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

/** The least stretch of sea a chart shows, in tiles, so a lone archipelago is not drawn as a continent. */
const MIN_CHART_SPAN_TILES = 1300;
/** Room round each place for its island and its lettering. */
const PLACE_ROOM_TILES = 220;

/**
 * Fits the chart's places into a canvas, with room for lettering round the edge.
 *
 * A player's chart holds only what they have seen, so the frame follows it: a newcomer's chart is
 * their own archipelago, drawn large, and it widens as they travel. The harbour's chart (a reader
 * without a place) keeps the Centre in view, since it is the whole open world round it.
 */
export function fitChart(chart: GetWorldChartResponse, width: number, height: number, margin = 0.12): ChartFrame {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const include = (x: number, z: number, room: number): void => {
    minX = Math.min(minX, x - room);
    maxX = Math.max(maxX, x + room);
    minZ = Math.min(minZ, z - room);
    maxZ = Math.max(maxZ, z + room);
  };
  for (const entry of chart.regions) {
    for (const archipelago of entry.archipelagos) {
      for (const slot of archipelago.slots) include(slot.x, slot.z, PLACE_ROOM_TILES);
    }
  }
  if (chart.mySlotId === null || !Number.isFinite(minX)) include(0, 0, 300);
  const centreX = (minX + maxX) / 2;
  const centreZ = (minZ + maxZ) / 2;
  const spanX = Math.max(MIN_CHART_SPAN_TILES, maxX - minX);
  const spanZ = Math.max(MIN_CHART_SPAN_TILES, maxZ - minZ);
  const scale = Math.min((width * (1 - margin * 2)) / spanX, (height * (1 - margin * 2)) / spanZ);
  return { scale, offsetX: width / 2 - centreX * scale, offsetY: height / 2 - centreZ * scale };
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
  const compact = options.compact === true;
  const frame = fitChart(chart, width, height, compact ? 0.08 : 0.12);
  if (context === null) return frame;
  const t = options.translate;
  const scaleText = Math.max(0.6, Math.min(width, height) / 900);
  const serif = '"Palatino Linotype", "Book Antiqua", Georgia, serif';
  const archipelagos = chart.regions.flatMap((entry) => entry.archipelagos.map((archipelago) => ({ region: entry.region, archipelago })));

  // Where the wind rose stands: on the Centre when the chart reaches it, else in a corner, as a
  // chart-maker would put it when the hub lies off the sheet.
  const hub = toCanvas(frame, 0, 0);
  const hubShown = hub.x > width * 0.08 && hub.x < width * 0.92 && hub.y > height * 0.08 && hub.y < height * 0.92;
  const rose = hubShown ? hub : { x: width * 0.13, y: height * 0.84 };
  const roseSize = compact
    ? Math.max(12, 200 * frame.scale)
    : hubShown
      ? Math.max(24, Math.min(260 * frame.scale, Math.min(width, height) * 0.09))
      : Math.min(width, height) * 0.07;

  drawParchment(context, width, height);
  context.fillStyle = SEA_TINT;
  context.fillRect(0, 0, width, height);
  drawRhumbLines(context, rose.x, rose.y, Math.hypot(width, height));

  // The unknown sea, under a mist, with the waters the player has seen cleared out of it.
  if (typeof document !== "undefined") {
    const fog = document.createElement("canvas");
    fog.width = width;
    fog.height = height;
    const mist = fog.getContext("2d");
    if (mist !== null) {
      mist.fillStyle = "rgba(242, 234, 214, 0.86)";
      mist.fillRect(0, 0, width, height);
      mist.globalCompositeOperation = "destination-out";
      const clear = (x: number, y: number, r: number): void => {
        const hole = mist.createRadialGradient(x, y, r * 0.55, x, y, r);
        hole.addColorStop(0, "rgba(0, 0, 0, 1)");
        hole.addColorStop(1, "rgba(0, 0, 0, 0)");
        mist.fillStyle = hole;
        mist.fillRect(x - r, y - r, r * 2, r * 2);
      };
      for (const { archipelago } of archipelagos) {
        const at = toCanvas(frame, archipelago.centreX, archipelago.centreZ);
        clear(at.x, at.y, 560 * frame.scale);
      }
      if (hubShown) clear(rose.x, rose.y, roseSize * 2.2);
      context.drawImage(fog, 0, 0);
    }
  }

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

  // Islands, archipelago by archipelago, each settled one with its name.
  const islandPixels = Math.max(compact ? 20 : 16, 150 * frame.scale);
  const named = !compact && islandPixels >= 18;
  for (const { region, archipelago } of archipelagos) {
    const dim = options.selectedRegion !== undefined && options.selectedRegion !== null && options.selectedRegion !== region;
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
      if (named && slot.name !== null) {
        context.fillStyle = slot.mine ? "#7a2414" : INK;
        context.font = `italic ${slot.mine ? "bold " : ""}${String(Math.round(11 * scaleText))}px ${serif}`;
        context.textAlign = "center";
        context.textBaseline = "top";
        context.fillText(slot.name, at.x, at.y + islandPixels * 0.55, islandPixels * 2.6);
      }
    }
    if (!compact) {
      context.fillStyle = INK;
      context.font = `italic bold ${String(Math.round(14 * scaleText))}px ${serif}`;
      context.textAlign = "center";
      context.textBaseline = "top";
      context.fillText(t("chart.archipelago", { name: archipelagoName(region, archipelago.index) }), centre.x, centre.y + 360 * frame.scale);
    }
    context.globalAlpha = 1;
  }

  // Each sea's name, out beyond its archipelagos (away from the Centre), kept on the sheet.
  for (const region of SEA_REGION_ORDER) {
    const entry = chart.regions.find((candidate) => candidate.region === region);
    if (entry === undefined || entry.archipelagos.length === 0) continue;
    const mean = entry.archipelagos.reduce((sum, archipelago) => ({ x: sum.x + archipelago.centreX, z: sum.z + archipelago.centreZ }), { x: 0, z: 0 });
    const cx = mean.x / entry.archipelagos.length;
    const cz = mean.z / entry.archipelagos.length;
    const away = Math.hypot(cx, cz) || 1;
    const at = toCanvas(frame, cx + (cx / away) * 470, cz + (cz / away) * 470);
    const lit = options.selectedRegion === region;
    const size = compact ? Math.min(width, height) * 0.075 : 26 * scaleText;
    context.fillStyle = lit ? "#7a2414" : INK;
    context.font = `italic ${lit ? "bold " : ""}${String(Math.round(size))}px ${serif}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    const label = t(`chart.region.${region}`);
    const half = context.measureText(label).width / 2 + 14;
    context.fillText(label, Math.min(width - half, Math.max(half, at.x)), Math.min(height - size, Math.max(size, at.y)));
  }

  // The wind rose, and the hub's name under it when the hub is on the sheet.
  drawWindRose(context, rose.x, rose.y, roseSize, t("chart.northMark"));
  if (!compact && hubShown) {
    context.fillStyle = INK;
    context.font = `bold ${String(Math.round(14 * scaleText))}px ${serif}`;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText(t("chart.centre"), rose.x, rose.y + roseSize * 1.18);
  }

  if (!compact) {
    const near = (x: number, y: number): boolean => {
      for (const { archipelago } of archipelagos) {
        const at = toCanvas(frame, archipelago.centreX, archipelago.centreZ);
        if (Math.hypot(at.x - x, at.y - y) < 420 * frame.scale) return true;
      }
      return Math.hypot(x - rose.x, y - rose.y) < roseSize * 1.6;
    };
    drawWaves(context, width, height, near);
    // The doodles live out in the unknown water, where a chart-maker drew what they had not seen.
    const corners = [
      { x: width * 0.8, y: height * 0.2 },
      { x: width * 0.2, y: height * 0.2 },
      { x: width * 0.8, y: height * 0.8 },
      { x: width * 0.2, y: height * 0.8 }
    ].filter((corner) => !near(corner.x, corner.y) && Math.hypot(corner.x - rose.x, corner.y - rose.y) > roseSize * 2.5);
    const ship = corners[0];
    const serpent = corners[1];
    if (ship !== undefined) drawGalleon(context, ship.x, ship.y, 24 * scaleText);
    if (serpent !== undefined) drawSerpent(context, serpent.x, serpent.y, 30 * scaleText);
    context.fillStyle = INK_SOFT;
    context.font = `italic ${String(Math.round(13 * scaleText))}px ${serif}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (const spot of [{ x: width * 0.84, y: height * 0.93 }, { x: width * 0.17, y: height * 0.07 }]) {
      if (!near(spot.x, spot.y)) context.fillText(t("chart.unexplored"), spot.x, spot.y);
    }
  }

  // The sheet's own edges darken a little, as old paper does.
  const vignette = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.45, width / 2, height / 2, Math.max(width, height) * 0.75);
  vignette.addColorStop(0, "rgba(120, 84, 40, 0)");
  vignette.addColorStop(1, "rgba(120, 84, 40, 0.16)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);

  // The frame: a double rule, as a chart's border.
  context.strokeStyle = INK;
  context.lineWidth = 2;
  context.strokeRect(6, 6, width - 12, height - 12);
  context.lineWidth = 0.8;
  context.strokeRect(11, 11, width - 22, height - 22);
  return frame;
}

/** A ship on the chart at one moment: where it is, which way it sails, and whose it is. */
export interface ChartShip {
  readonly x: number;
  readonly z: number;
  /** Radians, chart axes (+x east, +z south). */
  readonly heading: number;
  readonly mine: boolean;
  readonly name: string | null;
  readonly arrived: boolean;
  readonly fromX: number;
  readonly fromZ: number;
  readonly toX: number;
  readonly toZ: number;
}

function chartPosition(chart: GetWorldChartResponse, slotId: string): { readonly x: number; readonly z: number } | null {
  for (const entry of chart.regions) {
    for (const archipelago of entry.archipelagos) {
      const slot = archipelago.slots.find((candidate) => candidate.slotId === slotId);
      if (slot !== undefined) return { x: slot.x, z: slot.z };
    }
  }
  return null;
}

/**
 * Where every ship at sea is at `serverNowMs`: along the line from its port to its destination, by
 * the share of its voyage's time gone. Computed here, never asked of the server. A ship whose ends
 * are not both on the reader's chart is left out.
 */
export function chartShips(chart: GetWorldChartResponse, serverNowMs: number): ChartShip[] {
  const ships: ChartShip[] = [];
  for (const voyage of chart.voyages ?? []) {
    const from = chartPosition(chart, voyage.fromSlotId);
    const to = chartPosition(chart, voyage.toSlotId);
    if (from === null || to === null) continue;
    const start = Date.parse(voyage.departedAt);
    const end = Date.parse(voyage.arrivesAt);
    const share = end <= start ? 1 : Math.min(1, Math.max(0, (serverNowMs - start) / (end - start)));
    ships.push({
      x: from.x + (to.x - from.x) * share,
      z: from.z + (to.z - from.z) * share,
      heading: Math.atan2(to.z - from.z, to.x - from.x),
      mine: voyage.mine,
      name: voyage.name,
      arrived: share >= 1,
      fromX: from.x,
      fromZ: from.z,
      toX: to.x,
      toZ: to.z
    });
  }
  return ships;
}

/** Draws the ships at sea over a drawn chart: a dotted course to each destination, and the ship on it. */
export function drawChartShips(canvas: HTMLCanvasElement, frame: ChartFrame, ships: readonly ChartShip[]): void {
  const context = canvas.getContext("2d");
  if (context === null) return;
  const size = Math.max(7, Math.min(16, 90 * frame.scale));
  for (const ship of ships) {
    const point = toCanvas(frame, ship.x, ship.z);
    // A ship that has arrived lies at anchor beside the island, not on top of it.
    const at = ship.arrived ? { x: point.x + size * 1.6, y: point.y + size * 0.4 } : point;
    const to = toCanvas(frame, ship.toX, ship.toZ);
    if (!ship.arrived) {
      context.save();
      context.strokeStyle = ship.mine ? "rgba(168, 64, 44, 0.7)" : "rgba(59, 42, 26, 0.45)";
      context.lineWidth = ship.mine ? 1.6 : 1;
      context.setLineDash([2, 4]);
      context.beginPath();
      context.moveTo(at.x, at.y);
      context.lineTo(to.x, to.y);
      context.stroke();
      context.restore();
    }
    context.save();
    context.translate(at.x, at.y);
    // The galleon is drawn facing east; it turns to its course, and never sails upside down.
    const facingWest = Math.cos(ship.heading) < 0;
    context.scale(facingWest ? -1 : 1, 1);
    drawGalleon(context, 0, size * 0.25, size);
    if (ship.mine) {
      context.fillStyle = "#c0392b";
      context.beginPath();
      context.moveTo(size * 0.05, -size * 1.25);
      context.lineTo(size * 0.55, -size * 1.12);
      context.lineTo(size * 0.05, -size * 0.98);
      context.closePath();
      context.fill();
    }
    context.restore();
    if (ship.name !== null && size >= 10) {
      context.fillStyle = ship.mine ? "#7a2414" : INK;
      context.font = `italic ${String(Math.round(size * 0.85))}px "Palatino Linotype", "Book Antiqua", Georgia, serif`;
      context.textAlign = "center";
      context.textBaseline = "top";
      context.fillText(ship.name, at.x, at.y + size * 0.55);
    }
  }
}
