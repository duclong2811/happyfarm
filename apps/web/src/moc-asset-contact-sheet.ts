import type { RoadTierId } from "@happy-farm/game-data";
import {
  Box3,
  CircleGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  PlaneGeometry,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Object3D
} from "three";
import { buildLandmarkNode } from "./render/landmarks";
import { createSharedAssets } from "./render/materials";
import { modelUrlFor, sharedModelLibrary } from "./render/model-library";
import { characterVisualScale, PLAYER_CHARACTER_ASSET } from "./render/player-character";
import { createThumbnailRenderer, type ThumbnailResult } from "./render/thumbnail";

type AssetGroup = "Cây" | "Bụi · cỏ · đá" | "Nhà · kho · công trình" | "Gỗ · stump · props" | "Dock · đường · hàng rào";
type AssetKind = "MODEL" | "ROAD" | "PROCEDURAL" | "MISSING";

interface AssetCard {
  readonly id: string;
  readonly group: AssetGroup;
  readonly displayName: string;
  readonly kind: AssetKind;
  readonly modelId?: string;
  readonly roadTierId?: RoadTierId;
  readonly builder?: "FARMHOUSE" | "MARKET_STALL" | "HARBOR";
  readonly source: string;
  readonly homeUse: string;
  readonly homeScale: string;
  readonly recommendation: "Đề xuất Mộc" | "Có thể dùng" | "Không dùng trực tiếp ở HOME" | "Thiếu / chưa có";
  readonly note?: string;
}

const CARDS: readonly AssetCard[] = [
  { id: "tree_broad_2", group: "Cây", displayName: "Cây tán rộng 02", kind: "MODEL", modelId: "tree_broad_2", source: "apps/web/src/assets/models/environment/tree_broad_2.glb · environment-model-urls.ts", homeUse: "HOME scenery HERO", homeScale: "SceneryInstance.scale theo placement; unitScale=1", recommendation: "Đề xuất Mộc" },
  { id: "tree_broad_3", group: "Cây", displayName: "Cây tán rộng 03", kind: "MODEL", modelId: "tree_broad_3", source: "apps/web/src/assets/models/environment/tree_broad_3.glb · environment-model-urls.ts", homeUse: "HOME tree instance / biến thể tán rộng", homeScale: "TREE_MODEL_SCALE ≈ 1.52 cho tree instance", recommendation: "Đề xuất Mộc" },
  { id: "tree_pine_2", group: "Cây", displayName: "Thông 02", kind: "MODEL", modelId: "tree_pine_2", source: "apps/web/src/assets/models/environment/tree_pine_2.glb · environment-model-urls.ts", homeUse: "HOME scenery HERO", homeScale: "SceneryInstance.scale theo placement; unitScale=1", recommendation: "Đề xuất Mộc" },
  { id: "resource_wildwood", group: "Cây", displayName: "Wildwood trưởng thành", kind: "MODEL", modelId: "resource_wildwood", source: "apps/web/src/assets/models/resources/resource_wildwood.glb · model-urls.ts / assets.ts", homeUse: "HOME forestry tree instance", homeScale: "TREE_MODEL_SCALE theo treePlant; asset generated 1×1×1 envelope", recommendation: "Đề xuất Mộc" },
  { id: "resource_pine", group: "Cây", displayName: "Thông tài nguyên", kind: "MODEL", modelId: "resource_pine", source: "apps/web/src/assets/models/resources/resource_pine.glb · model-urls.ts / assets.ts", homeUse: "Có registry và file; chưa có path HOME trực tiếp", homeScale: "Chưa xác định HOME runtime", recommendation: "Có thể dùng", note: "Không tự gán vào HOME; cần thiết kế/contract riêng." },
  { id: "resource_hardwood", group: "Cây", displayName: "Hardwood trưởng thành", kind: "MODEL", modelId: "resource_hardwood", source: "apps/web/src/assets/models/resources/resource_hardwood.glb · model-urls.ts / assets.ts", homeUse: "Có registry và file; chưa có path HOME trực tiếp", homeScale: "Chưa xác định HOME runtime", recommendation: "Có thể dùng", note: "Đây là asset generated hiện có, không phải asset tải ngoài." },

  { id: "bush_leafy", group: "Bụi · cỏ · đá", displayName: "Bụi lá", kind: "MODEL", modelId: "bush_leafy", source: "apps/web/src/assets/models/environment/bush_leafy.glb · environment-model-urls.ts", homeUse: "HOME scenery HERO", homeScale: "SceneryInstance.scale theo placement; unitScale=1", recommendation: "Đề xuất Mộc" },
  { id: "bush_flowering", group: "Bụi · cỏ · đá", displayName: "Bụi có hoa", kind: "MODEL", modelId: "bush_flowering", source: "apps/web/src/assets/models/environment/bush_flowering.glb · environment-model-urls.ts", homeUse: "HOME scenery HERO", homeScale: "SceneryInstance.scale theo placement; unitScale=1", recommendation: "Có thể dùng" },
  { id: "rock_boulder_1", group: "Bụi · cỏ · đá", displayName: "Đá tảng 01", kind: "MODEL", modelId: "rock_boulder_1", source: "apps/web/src/assets/models/environment/rock_boulder_1.glb · environment-model-urls.ts", homeUse: "HOME scenery HERO", homeScale: "SceneryInstance.scale theo placement; unitScale=1", recommendation: "Đề xuất Mộc" },
  { id: "plant_grass_tall", group: "Bụi · cỏ · đá", displayName: "Cỏ cao", kind: "MODEL", modelId: "plant_grass_tall", source: "apps/web/src/assets/models/environment/plant_grass_tall.glb · environment-model-urls.ts", homeUse: "HOME detail scenery", homeScale: "SceneryInstance.scale theo placement; unitScale=1", recommendation: "Có thể dùng" },
  { id: "plant_fern", group: "Bụi · cỏ · đá", displayName: "Dương xỉ", kind: "MODEL", modelId: "plant_fern", source: "apps/web/src/assets/models/environment/plant_fern.glb · environment-model-urls.ts", homeUse: "HOME detail scenery", homeScale: "SceneryInstance.scale theo placement; unitScale=1", recommendation: "Có thể dùng" },

  { id: "farm.barn.t2", group: "Nhà · kho · công trình", displayName: "Kho / barn T2", kind: "MODEL", modelId: "farm.barn.t2", source: "apps/web/src/assets/models/farm-buildings/farm.barn.t2.glb · building-model-urls.ts", homeUse: "Storage shed tier 2 / Mộc house shell", homeScale: "sizeWorld=6.4m", recommendation: "Đề xuất Mộc" },
  { id: "farm.barn.t1", group: "Nhà · kho · công trình", displayName: "Kho / barn T1", kind: "MODEL", modelId: "farm.barn.t1", source: "apps/web/src/assets/models/farm-buildings/farm.barn.t1.glb · building-model-urls.ts", homeUse: "HOME storage shed tier 1 / store shell", homeScale: "sizeWorld=4.6m", recommendation: "Đề xuất Mộc" },
  { id: "farm.openbarn.t1", group: "Nhà · kho · công trình", displayName: "Chòi mở", kind: "MODEL", modelId: "farm.openbarn.t1", source: "apps/web/src/assets/models/farm-buildings/farm.openbarn.t1.glb · building-model-urls.ts", homeUse: "HOME open barn landmark", homeScale: "sizeWorld=5.2m", recommendation: "Đề xuất Mộc" },
  { id: "farmhouse.procedural", group: "Nhà · kho · công trình", displayName: "Nhà ở procedural", kind: "PROCEDURAL", builder: "FARMHOUSE", source: "apps/web/src/render/landmarks.ts · buildFarmhouse()", homeUse: "HOME farmhouse tier 1 fallback", homeScale: "builder scale=1.7; primitive, không có GLB riêng", recommendation: "Đề xuất Mộc" },
  { id: "warehouse.reserved", group: "Nhà · kho · công trình", displayName: "Kho reserved tương lai", kind: "MISSING", source: "apps/web/src/render/buildings.ts · RESERVED_BUILDINGS.WAREHOUSE", homeUse: "Chỉ có reserved plot/ladder; không được render hiện tại", homeScale: "Chưa có model hoặc builder riêng", recommendation: "Thiếu / chưa có", note: "Card cố ý không có ảnh thay thế." },

  { id: "resource_wildwood_stump", group: "Gỗ · stump · props", displayName: "Stump Wildwood", kind: "MODEL", modelId: "resource_wildwood_stump", source: "apps/web/src/assets/models/resources/resource_wildwood_stump.glb · model-urls.ts / specs.mjs", homeUse: "Mộc presentation prop / forestry residue", homeScale: "Generated envelope 1; scene scale theo prop", recommendation: "Đề xuất Mộc" },
  { id: "resource_pine_stump", group: "Gỗ · stump · props", displayName: "Stump thông", kind: "MODEL", modelId: "resource_pine_stump", source: "apps/web/src/assets/models/resources/resource_pine_stump.glb · model-urls.ts / specs.mjs", homeUse: "Mộc presentation prop / forestry residue", homeScale: "Generated envelope 1; scene scale theo prop", recommendation: "Đề xuất Mộc" },
  { id: "prop_wagon", group: "Gỗ · stump · props", displayName: "Xe kéo", kind: "MODEL", modelId: "prop_wagon", source: "apps/web/src/assets/models/props/prop_wagon.glb · prop-model-urls.ts", homeUse: "HOME barn yard composition", homeScale: "sizeWorld=2.2m; composition scale=1", recommendation: "Đề xuất Mộc" },
  { id: "prop_crate_wooden", group: "Gỗ · stump · props", displayName: "Thùng gỗ", kind: "MODEL", modelId: "prop_crate_wooden", source: "apps/web/src/assets/models/props/prop_crate_wooden.glb · prop-model-urls.ts", homeUse: "HOME / neighbor yard dressing", homeScale: "sizeWorld=0.7m; scale theo prop", recommendation: "Đề xuất Mộc" },
  { id: "prop_axe", group: "Gỗ · stump · props", displayName: "Rìu", kind: "MODEL", modelId: "prop_axe", source: "apps/web/src/assets/models/props/prop_axe.glb · prop-model-urls.ts", homeUse: "Neighbor forestry presentation / NPC tool", homeScale: "sizeWorld=0.8m; scene scale theo prop", recommendation: "Đề xuất Mộc" },
  { id: "prop_anvil_log", group: "Gỗ · stump · props", displayName: "Đe trên log", kind: "MODEL", modelId: "prop_anvil_log", source: "apps/web/src/assets/models/props/prop_anvil_log.glb · prop-model-urls.ts", homeUse: "Mộc work yard presentation", homeScale: "sizeWorld=1.2m; scene scale=1.05 ở neighbor", recommendation: "Đề xuất Mộc" },
  { id: "prop_workbench", group: "Gỗ · stump · props", displayName: "Bàn làm việc", kind: "MODEL", modelId: "prop_workbench", source: "apps/web/src/assets/models/props/prop_workbench.glb · prop-model-urls.ts", homeUse: "HOME barn yard composition / Mộc work yard", homeScale: "sizeWorld=1.9m; composition scale=1", recommendation: "Đề xuất Mộc" },

  { id: "prop_fence_rail_long", group: "Dock · đường · hàng rào", displayName: "Hàng rào dài", kind: "MODEL", modelId: "prop_fence_rail_long", source: "apps/web/src/assets/models/props/prop_fence_rail_long.glb · prop-model-urls.ts", homeUse: "HOME barn yard composition", homeScale: "sizeWorld=2.1m; composition scale=1", recommendation: "Đề xuất Mộc" },
  { id: "road.dirt.t1", group: "Dock · đường · hàng rào", displayName: "Đường đất", kind: "ROAD", roadTierId: "road.dirt.t1", source: "apps/web/src/render/thumbnail.ts · buildRoadSpec()/ribbonSurface()", homeUse: "HOME road network", homeScale: "ROAD_SEGMENT_CELLS=4; width theo ROAD_WIDTH_TILES", recommendation: "Đề xuất Mộc" },
  { id: "road.stone.t3", group: "Dock · đường · hàng rào", displayName: "Đường đá", kind: "ROAD", roadTierId: "road.stone.t3", source: "apps/web/src/render/thumbnail.ts · buildRoadSpec()/stonePlateSurface()", homeUse: "HOME primary road tier", homeScale: "ROAD_SEGMENT_CELLS=4; width theo ROAD_WIDTH_TILES", recommendation: "Có thể dùng" },
  { id: "harbor.procedural", group: "Dock · đường · hàng rào", displayName: "Dock / harbour procedural", kind: "PROCEDURAL", builder: "HARBOR", source: "apps/web/src/render/terrain.ts · addHarbour()", homeUse: "HOME harbour/dock", homeScale: "Derived from HARBOUR + FarmLayout; không có GLB riêng", recommendation: "Đề xuất Mộc", note: "Thumbnails procedural của landmark có thể duyệt; geometry dock đầy đủ vẫn nằm trong terrain builder." },
  { id: "market.procedural", group: "Dock · đường · hàng rào", displayName: "Chòi/market procedural", kind: "PROCEDURAL", builder: "MARKET_STALL", source: "apps/web/src/render/landmarks.ts · buildMarketStall()", homeUse: "HOME market landmark", homeScale: "builder scale=1.7; không có GLB riêng", recommendation: "Có thể dùng" }
];

const groupOrder: readonly AssetGroup[] = ["Cây", "Bụi · cỏ · đá", "Nhà · kho · công trình", "Gỗ · stump · props", "Dock · đường · hàng rào"];
const errors: string[] = [];
const content = document.querySelector<HTMLElement>("#content") ?? (() => { throw new Error("contact sheet content root is missing"); })();
const errorOutput = document.querySelector<HTMLElement>("#errors") ?? (() => { throw new Error("contact sheet errors root is missing"); })();

const library = sharedModelLibrary({ onProblem: (modelId, error) => errors.push(`${modelId}: ${String(error)}`) });
const thumbnails = createThumbnailRenderer({ library, onProblem: (modelId, error) => errors.push(`${modelId}: ${String(error)}`) });
const procedural = createProceduralRenderer();
const renderedImages = new Map<string, HTMLImageElement>();

type TextTag = "h2" | "h3" | "p" | "div" | "dt" | "dd";

function text(parent: HTMLElement, tag: TextTag, value: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className !== undefined) node.className = className;
  parent.appendChild(node);
  return node;
}

function definitionList(card: AssetCard, status: HTMLElement): HTMLElement {
  const dl = document.createElement("dl");
  for (const [label, value] of [["Asset", card.id], ["Source", card.source], ["HOME", card.homeUse], ["Scale", card.homeScale], ["Khuyến nghị", card.recommendation]] as const) {
    text(dl, "dt", label);
    text(dl, "dd", value);
  }
  if (card.note !== undefined) {
    text(dl, "dt", "Ghi chú");
    text(dl, "dd", card.note);
  }
  dl.appendChild(status);
  return dl;
}

function cardElement(card: AssetCard): { readonly article: HTMLElement; readonly status: HTMLElement; readonly imageHost: HTMLElement } {
  const article = document.createElement("article");
  if (card.recommendation === "Đề xuất Mộc") article.classList.add("recommended");
  if (card.kind === "MISSING") article.classList.add("missing");
  const imageHost = document.createElement("div");
  imageHost.className = "thumb";
  const status = document.createElement("div");
  status.className = "status";
  status.textContent = card.kind === "MISSING" ? "THIẾU / CHƯA CÓ — không thay ảnh" : "Đang kiểm tra…";
  text(article, "h3", card.displayName);
  article.insertBefore(imageHost, article.firstChild);
  article.appendChild(definitionList(card, status));
  return { article, status, imageHost };
}

async function renderCard(card: AssetCard, host: HTMLElement, status: HTMLElement): Promise<void> {
  if (card.kind === "MISSING") {
    text(host, "div", "Không có model/builder độc lập trong repo", "placeholder");
    return;
  }
  let result: ThumbnailResult | null = null;
  if (card.kind === "MODEL" && card.modelId !== undefined) {
    const registered = modelUrlFor(card.modelId) !== undefined;
    if (!registered) {
      text(host, "div", "REGISTRY MISSING", "placeholder");
      status.classList.add("error");
      status.textContent = "REGISTRY MISSING — không có URL trong model-library";
      return;
    }
    result = await thumbnails.render({ modelId: card.modelId, roadTierId: null });
  } else if (card.kind === "ROAD" && card.roadTierId !== undefined) {
    result = await thumbnails.render({ modelId: null, roadTierId: card.roadTierId });
  } else if (card.kind === "PROCEDURAL" && card.builder !== undefined) {
    result = await procedural.render(card.builder);
  }
  if (result?.dataUrl === null || result === null) {
    text(host, "div", "RENDER FAILED — không dùng ảnh thay thế", "placeholder");
    status.classList.add("error");
    status.textContent = `RENDER FAILED · source=${result?.source ?? "none"}`;
    return;
  }
  const image = document.createElement("img");
  image.alt = card.displayName;
  image.src = result.dataUrl;
  host.appendChild(image);
  renderedImages.set(card.id, image);
  status.textContent = `Đã render · ${result.source === "MODEL" ? "GLB" : result.source === "ROAD" ? "procedural road" : "procedural builder"}`;
}

async function renderSheet(): Promise<void> {
  for (const group of groupOrder) {
    const section = document.createElement("section");
    text(section, "h2", group);
    const grid = document.createElement("div");
    grid.className = "sheet";
    section.appendChild(grid);
    content.appendChild(section);
    for (const card of CARDS.filter((item) => item.group === group)) {
      const view = cardElement(card);
      grid.appendChild(view.article);
      try {
        await renderCard(card, view.imageHost, view.status);
      } catch (error: unknown) {
        errors.push(`${card.id}: ${String(error)}`);
        view.status.classList.add("error");
        view.status.textContent = "RENDER ERROR — xem manifest/log";
        text(view.imageHost, "div", "RENDER ERROR — không dùng ảnh thay thế", "placeholder");
      }
    }
  }
  await renderScaleReference();
  errorOutput.textContent = errors.length === 0 ? "" : `Render diagnostics:\n${errors.join("\n")}`;
}

async function renderScaleReference(): Promise<void> {
  const section = document.createElement("section");
  text(section, "h2", "Khung so tỷ lệ HOME");
  const comparison = document.createElement("div");
  comparison.className = "comparison";
  text(comparison, "p", "Một camera và một mặt đất chung; model dùng scale runtime HOME, không fit riêng từng model trong khung này.");
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 330;
  comparison.appendChild(canvas);
  section.appendChild(comparison);
  content.appendChild(section);
  const renderer = createScaleReferenceRenderer(canvas);
  if (renderer === null) {
    text(comparison, "div", "SCALE REFERENCE FAILED — không dùng ảnh thay thế", "placeholder");
    return;
  }
  const result = await renderer.render();
  if (!result) {
    text(comparison, "div", "SCALE REFERENCE FAILED — thiếu một model cần thiết", "placeholder");
    return;
  }
  text(comparison, "p", "Trái → phải: character.player_farmer · resource_wildwood · farm.barn.t2 · farm.barn.t1. Đây là cùng một camera/mặt đất, không phải bốn thumbnail fit riêng.");
}

interface ScaleReferenceRenderer {
  render(): Promise<boolean>;
}

function createScaleReferenceRenderer(canvas: HTMLCanvasElement): ScaleReferenceRenderer | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  } catch (error: unknown) {
    errors.push(`scale reference renderer: ${String(error)}`);
    return null;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.width, canvas.height, false);
  const scene = new Scene();
  scene.background = new Color(0xf0f2ed);
  const camera = new OrthographicCamera(-9, 9, 3.3, -3.3, 0.05, 60);
  camera.position.set(10, 8, 12);
  const focus = new Vector3(0, 2.4, 0);
  camera.lookAt(focus);
  const ground = new Mesh(new PlaneGeometry(18, 12), new MeshStandardMaterial({ color: 0xdce7d5, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground, new DirectionalLight(0xfff4e2, 2.1), new HemisphereLight(0xffffff, 0x95ae8e, 1.35));

  const specs = [
    { modelId: PLAYER_CHARACTER_ASSET.modelId, x: -6.2, scale: "character" as const },
    { modelId: "resource_wildwood", x: -2.1, scale: "tree" as const },
    { modelId: "farm.barn.t2", x: 2.25, scale: "barn-t2" as const },
    { modelId: "farm.barn.t1", x: 6.35, scale: "barn-t1" as const }
  ];

  return {
    async render(): Promise<boolean> {
      const nodes: Object3D[] = [];
      for (const spec of specs) {
        const source = await library.load(spec.modelId);
        if (source === null) {
          errors.push(`scale reference: missing ${spec.modelId}`);
          renderer.dispose();
          return false;
        }
        const node = source.clone(true);
        const rawBox = new Box3().setFromObject(node);
        const rawSize = rawBox.getSize(new Vector3());
        const rawHeight = Math.max(rawSize.y, 0.001);
        const scale = spec.scale === "character"
          ? characterVisualScale(PLAYER_CHARACTER_ASSET, rawHeight)
          : spec.scale === "tree"
            ? 2.6 / 1.708
            : spec.scale === "barn-t2"
              ? 6.4
              : 4.6;
        node.scale.setScalar(scale);
        node.updateMatrixWorld(true);
        const box = new Box3().setFromObject(node);
        const center = box.getCenter(new Vector3());
        node.position.set(spec.x - center.x, -box.min.y, -center.z);
        scene.add(node);
        nodes.push(node);
      }
      renderer.render(scene, camera);
      for (const node of nodes) scene.remove(node);
      renderer.dispose();
      ground.geometry.dispose();
      ground.material.dispose();
      return true;
    }
  };
}

function downloadText(filename: string, contentText: string, type: string): void {
  const blob = new Blob([contentText], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

document.querySelector<HTMLButtonElement>("#download-manifest")?.addEventListener("click", () => {
  downloadText("moc-asset-contact-sheet-manifest.json", JSON.stringify(CARDS, null, 2), "application/json");
});

document.querySelector<HTMLButtonElement>("#download-all")?.addEventListener("click", () => {
  for (const group of groupOrder) {
    const cards = CARDS.filter((item) => item.group === group).filter((item) => renderedImages.has(item.id));
    if (cards.length === 0) continue;
    const canvas = document.createElement("canvas");
    canvas.width = 4 * 256;
    canvas.height = Math.ceil(cards.length / 4) * 320;
    const ctx = canvas.getContext("2d");
    if (ctx === null) continue;
    ctx.fillStyle = "#eef1ec";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const [index, card] of cards.entries()) {
      const image = renderedImages.get(card.id);
      if (image === undefined) continue;
      const x = (index % 4) * 256;
      const y = Math.floor(index / 4) * 320;
      ctx.drawImage(image, x, y, 256, 256);
      ctx.fillStyle = "#26352a";
      ctx.font = "14px sans-serif";
      ctx.fillText(card.displayName, x + 8, y + 278);
      ctx.font = "11px sans-serif";
      ctx.fillText(card.id, x + 8, y + 297);
    }
    const anchor = document.createElement("a");
    anchor.href = canvas.toDataURL("image/png");
    anchor.download = `moc-asset-${group.replaceAll(" ", "-").replaceAll("·", "")}.png`;
    anchor.click();
  }
});

void renderSheet();

interface ProceduralThumbnailRenderer {
  render(builder: "FARMHOUSE" | "MARKET_STALL" | "HARBOR"): ThumbnailResult | Promise<ThumbnailResult>;
}

function createProceduralRenderer(): ProceduralThumbnailRenderer {
  const assets = createSharedAssets();
  let renderer: WebGLRenderer | null = null;
  let scene: Scene | null = null;
  let camera: PerspectiveCamera | null = null;
  let ground: Mesh | null = null;
  const direction = new Vector3(1, 0.72, 1.35).normalize();
  function stage(): boolean {
    if (renderer !== null && scene !== null && camera !== null) return true;
    try {
      renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch (error: unknown) {
      errors.push(`procedural renderer: ${String(error)}`);
      return false;
    }
    renderer.setPixelRatio(1);
    renderer.setSize(256, 256, false);
    scene = new Scene();
    scene.background = new Color(0xf0f2ed);
    camera = new PerspectiveCamera(32, 1, 0.05, 80);
    ground = new Mesh(new CircleGeometry(1, 48), new MeshStandardMaterial({ color: 0xdce7d5, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground, new DirectionalLight(0xfff4e2, 2.1), new HemisphereLight(0xffffff, 0x95ae8e, 1.35));
    return true;
  }
  return {
    render(builder): ThumbnailResult {
      if (!stage() || renderer === null || scene === null || camera === null || ground === null) {
        return { dataUrl: null, source: "FALLBACK" };
      }
      const node = buildLandmarkNode(assets, builder, "", () => undefined);
      if (node === null) return { dataUrl: null, source: "FALLBACK" };
      scene.add(node);
      const box = new Box3().setFromObject(node);
      const size = box.getSize(new Vector3());
      const centre = box.getCenter(new Vector3());
      node.position.set(-centre.x, -box.min.y, -centre.z);
      ground.scale.setScalar(Math.max(2.4, Math.max(size.x, size.z) * 0.9));
      const longest = Math.max(size.x, size.y, size.z, 0.001);
      const distance = Math.max(8, longest * 2.45);
      const focus = new Vector3(0, longest * 0.34, 0);
      camera.position.copy(direction).multiplyScalar(distance).add(focus);
      camera.lookAt(focus);
      renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL("image/png");
      scene.remove(node);
      return { dataUrl, source: "MODEL" };
    }
  };
}

