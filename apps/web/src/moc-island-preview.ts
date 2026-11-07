import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Object3D
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MOC_PREVIEW_LAYOUT, type MocPreviewPlacement } from "./moc-island-preview-data";
import { buildLandmarkNode } from "./render/landmarks";
import { createSharedAssets } from "./render/materials";
import { modelUrlFor, sharedModelLibrary } from "./render/model-library";
import { characterVisualScale, PLAYER_CHARACTER_ASSET } from "./render/player-character";
import { buildInstancedObjects, type InstancedPlacement } from "./render/scenery";
import { GROUND_SURFACE_Y } from "./render/terrain-height";
import { neighborGroundHeight, neighborOutlineRadius } from "./render/neighbor-island-template";

const layout = MOC_PREVIEW_LAYOUT;
const template = layout.template;
const dock = layout.dock;
const viewport = document.querySelector<HTMLElement>("#viewport") ?? (() => { throw new Error("preview viewport missing"); })();
const canvas = document.querySelector<HTMLCanvasElement>("#preview-canvas") ?? (() => { throw new Error("preview canvas missing"); })();
const labelLayer = document.querySelector<HTMLElement>("#labels") ?? (() => { throw new Error("preview labels missing"); })();
const status = document.querySelector<HTMLElement>("#status") ?? (() => { throw new Error("preview status missing"); })();
const missingOutput = document.querySelector<HTMLElement>("#missing") ?? (() => { throw new Error("preview missing output missing"); })();
const scaleInfo = document.querySelector<HTMLElement>("#scale-info") ?? (() => { throw new Error("preview scale info missing"); })();
const metricValues = [...(document.querySelectorAll<HTMLElement>("#metrics dd"))];
const labelsToggle = document.querySelector<HTMLInputElement>("#toggle-labels") ?? (() => { throw new Error("preview labels toggle missing"); })();

const errors: string[] = [];
const assets = createSharedAssets();
const library = sharedModelLibrary({ onProblem: (modelId, error) => errors.push(`${modelId}: ${String(error)}`) });
// Match the active neighbour renderer's normalized tree envelope. The previous 2.6m preview-only
// choice made the same authored forest read undersized after it was integrated into the game.
const MATURE_TREE_TARGET_HEIGHT = 3.8;
const treeScaleCorrections = new Map<string, number>();
const scene = new Scene();
scene.background = new Color(0xcfe9f7);
scene.fog = new Fog(0xcfe9f7, 95, 230);

const camera = new PerspectiveCamera(38, 1, 0.1, 260);
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.autoUpdate = true;
renderer.info.autoReset = false;

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = false;
controls.minDistance = 12;
controls.maxDistance = 180;
controls.maxPolarAngle = Math.PI * 0.48;

const worldRoot = new Group();
const scaleRoot = new Group();
scaleRoot.visible = false;
scene.add(worldRoot, scaleRoot);

const labelElements = layout.labels.map((label) => {
  const element = document.createElement("div");
  element.className = "label";
  element.textContent = label.text;
  element.dataset.labelId = label.id;
  labelLayer.appendChild(element);
  return { label, element };
});

const presets = {
  overview: { position: new Vector3(-78, 46, 74), target: new Vector3(2, 0.8, -6) },
  dock: {
    position: new Vector3(dock.land.x + dock.outward.x * 30, 17, dock.land.z + dock.outward.z * 30),
    target: new Vector3(dock.land.x - dock.outward.x * 11, 1.8, dock.land.z - dock.outward.z * 11)
  },
  yard: { position: new Vector3(42, 20, 27), target: new Vector3(13, 1.6, -5) },
  scale: { position: new Vector3(0, 9, 23), target: new Vector3(0, 2.1, 0) }
} as const;

function terrainY(x: number, z: number, offset = 0.06): number {
  return GROUND_SURFACE_Y + neighborGroundHeight(template, x, z) + offset;
}

function buildOutlinePrism(innerScale: number, outerScale: number, topY: number, bottomY: number): BufferGeometry {
  const sectors = 128;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const scale of [innerScale, outerScale]) {
    for (let index = 0; index < sectors; index += 1) {
      const angle = (index / sectors) * Math.PI * 2;
      const radius = neighborOutlineRadius(template, angle) * scale;
      positions.push(Math.cos(angle) * template.radiusX * radius, topY, Math.sin(angle) * template.radiusZ * radius);
    }
  }
  for (let index = 0; index < sectors; index += 1) {
    const next = (index + 1) % sectors;
    const inner = index;
    const innerNext = next;
    const outer = sectors + index;
    const outerNext = sectors + next;
    indices.push(inner, outerNext, outer, inner, innerNext, outerNext);
  }
  // A solid skirt avoids the rectangular-grid boundary triangles that previously cut through the sea.
  for (let index = 0; index < sectors; index += 1) {
    const angle = (index / sectors) * Math.PI * 2;
    const radius = neighborOutlineRadius(template, angle) * outerScale;
    positions.push(Math.cos(angle) * template.radiusX * radius, bottomY, Math.sin(angle) * template.radiusZ * radius);
  }
  for (let index = 0; index < sectors; index += 1) {
    const next = (index + 1) % sectors;
    const top = sectors + index;
    const topNext = sectors + next;
    const bottom = sectors * 2 + index;
    const bottomNext = sectors * 2 + next;
    indices.push(top, bottomNext, bottom, top, topNext, bottomNext);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildTerrain(): void {
  const rings = 56;
  const sectors = 128;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const groundGreen = new Color(0x74bd58);
  const hillGreen = new Color(0x86c15f);
  const addVertex = (angle: number, fraction: number): number => {
    const radius = neighborOutlineRadius(template, angle) * fraction;
    const x = Math.cos(angle) * template.radiusX * radius;
    const z = Math.sin(angle) * template.radiusZ * radius;
    const height = neighborGroundHeight(template, x, z);
    positions.push(x, GROUND_SURFACE_Y + height, z);
    const color = groundGreen.clone().lerp(hillGreen, Math.min(1, Math.max(0, height / Math.max(template.relief, 0.001))) * 0.35);
    colors.push(color.r, color.g, color.b);
    return positions.length / 3 - 1;
  };
  positions.push(0, GROUND_SURFACE_Y + neighborGroundHeight(template, 0, 0), 0);
  const centreColor = groundGreen.clone().lerp(hillGreen, 0.35);
  colors.push(centreColor.r, centreColor.g, centreColor.b);
  for (let ring = 1; ring <= rings; ring += 1) {
    for (let sector = 0; sector < sectors; sector += 1) {
      addVertex((sector / sectors) * Math.PI * 2, ring / rings);
    }
  }
  for (let sector = 0; sector < sectors; sector += 1) {
    const next = (sector + 1) % sectors;
    indices.push(0, 1 + next, 1 + sector);
  }
  for (let ring = 1; ring < rings; ring += 1) {
    const inner = 1 + (ring - 1) * sectors;
    const outer = 1 + ring * sectors;
    for (let sector = 0; sector < sectors; sector += 1) {
      const next = (sector + 1) % sectors;
      indices.push(inner + sector, outer + next, outer + sector);
      indices.push(inner + sector, inner + next, outer + next);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const terrain = new Mesh(geometry, assets.terrainGrass);
  terrain.receiveShadow = true;
  worldRoot.add(terrain);

  const beach = new Mesh(buildOutlinePrism(1.0, 1.09, GROUND_SURFACE_Y - 0.18, GROUND_SURFACE_Y - 0.78), assets.sand);
  worldRoot.add(beach);
  const skirt = new Mesh(buildOutlinePrism(0.0, 1.0, GROUND_SURFACE_Y - 0.005, GROUND_SURFACE_Y - 0.5), assets.grass);
  worldRoot.add(skirt);
  const wetRim = new Mesh(buildOutlinePrism(0.955, 1.0, GROUND_SURFACE_Y + 0.006, GROUND_SURFACE_Y + 0.006), assets.wetSand);
  worldRoot.add(wetRim);

  const water = new Mesh(new PlaneGeometry(210, 190), assets.waterDeep);
  water.rotation.x = -Math.PI / 2;
  water.position.y = GROUND_SURFACE_Y - 0.58;
  worldRoot.add(water);

  const outlinePoints: Vector3[] = [];
  for (let index = 0; index < 96; index += 1) {
    const angle = (index / 96) * Math.PI * 2;
    const radius = neighborOutlineRadius(template, angle);
    outlinePoints.push(new Vector3(Math.cos(angle) * template.radiusX * radius, GROUND_SURFACE_Y + 0.03, Math.sin(angle) * template.radiusZ * radius));
  }
  const outlineGeometry = new BufferGeometry().setFromPoints(outlinePoints);
  worldRoot.add(new LineLoop(outlineGeometry, new LineBasicMaterial({ color: 0x517e58, transparent: true, opacity: 0.56 })));
}

function buildRoads(): void {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let quad = 0;
  const width = 2.6;
  for (const route of layout.routes) {
    for (let index = 1; index < route.points.length; index += 1) {
      const start = route.points[index - 1];
      const end = route.points[index];
      if (start === undefined || end === undefined) continue;
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.max(Math.hypot(dx, dz), 0.001);
      const nx = -dz / length * width * 0.5;
      const nz = dx / length * width * 0.5;
      const corners = [
        { x: start.x + nx, z: start.z + nz },
        { x: start.x - nx, z: start.z - nz },
        { x: end.x - nx, z: end.z - nz },
        { x: end.x + nx, z: end.z + nz }
      ];
      for (const corner of corners) {
        positions.push(corner.x, terrainY(corner.x, corner.z, 0.075), corner.z);
        colors.push(1, 1, 1);
      }
      indices.push(quad, quad + 1, quad + 3, quad + 1, quad + 2, quad + 3);
      quad += 4;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  worldRoot.add(new Mesh(geometry, assets.roadDirt));
}

function addPad(x: number, z: number, width: number, depth: number, material: MeshStandardMaterial): void {
  const pad = new Mesh(assets.box, material);
  pad.scale.set(width * 0.5, 0.045, depth * 0.5);
  pad.position.set(x, terrainY(x, z, 0.025), z);
  worldRoot.add(pad);
}

function buildDock(): void {
  const outward = new Vector3(dock.outward.x, 0, dock.outward.z);
  const yaw = Math.atan2(outward.x, outward.z);
  const deckLength = Math.hypot(dock.water.x - dock.land.x, dock.water.z - dock.land.z);
  const deckCenter = new Vector3((dock.land.x + dock.water.x) * 0.5, GROUND_SURFACE_Y + 0.34, (dock.land.z + dock.water.z) * 0.5);
  const deck = new Mesh(assets.box, assets.timber);
  deck.scale.set(1.7, 0.12, deckLength * 0.5);
  deck.position.copy(deckCenter);
  deck.rotation.y = yaw;
  deck.castShadow = true;
  deck.receiveShadow = true;
  worldRoot.add(deck);
  for (const side of [-1, 1]) {
    for (const along of [3.0, 8.0, 13.0, 17.0]) {
      const centre = new Vector3(dock.land.x + outward.x * along, GROUND_SURFACE_Y - 0.2, dock.land.z + outward.z * along);
      const tangent = new Vector3(outward.z, 0, -outward.x);
      const post = new Mesh(assets.cylinder, assets.stakeWood);
      post.scale.set(0.13, 0.75, 0.13);
      post.position.set(
        centre.x + tangent.x * side * 1.25,
        centre.y,
        centre.z + tangent.z * side * 1.25
      );
      worldRoot.add(post);
    }
  }
}

function addProceduralPlacement(placement: MocPreviewPlacement): void {
  const builder = placement.modelId.slice("__procedural:".length);
  const node = buildLandmarkNode(assets, builder, "", () => undefined);
  if (node === null) {
    errors.push(`procedural builder missing: ${builder}`);
    return;
  }
  node.position.set(placement.x, terrainY(placement.x, placement.z, 0.02), placement.z);
  node.rotation.y = placement.rotationY;
  node.scale.multiplyScalar(placement.scale);
  node.traverse((child) => { child.castShadow = true; child.receiveShadow = true; });
  worldRoot.add(node);
}

function toInstancedPlacement(placement: MocPreviewPlacement, modelScaleCorrection = 1): InstancedPlacement {
  return {
    worldX: placement.x,
    worldY: terrainY(placement.x, placement.z),
    worldZ: placement.z,
    rotationY: placement.rotationY,
    sizeWorld: placement.scale * modelScaleCorrection
  };
}

function modelHeight(node: Object3D): number {
  node.updateMatrixWorld(true);
  return new Box3().setFromObject(node).getSize(new Vector3()).y;
}

async function buildPlacementModels(): Promise<void> {
  const buckets = new Map<string, MocPreviewPlacement[]>();
  for (const placement of layout.placements) {
    if (placement.modelId.startsWith("__procedural:")) {
      addProceduralPlacement(placement);
      continue;
    }
    if (modelUrlFor(placement.modelId) === undefined) {
      errors.push(`registry missing: ${placement.modelId}`);
      continue;
    }
    const bucket = buckets.get(placement.modelId) ?? [];
    bucket.push(placement);
    buckets.set(placement.modelId, bucket);
  }
  await Promise.all([...buckets.entries()].map(async ([modelId, placements]) => {
    const model = await library.load(modelId);
    if (model === null) {
      errors.push(`model failed: ${modelId}`);
      return;
    }
    const rawHeight = modelHeight(model);
    const correction = modelId.startsWith("tree_") && rawHeight > 0.001
      ? Math.max(1, MATURE_TREE_TARGET_HEIGHT / rawHeight)
      : 1;
    if (modelId.startsWith("tree_")) treeScaleCorrections.set(modelId, correction);
    buildInstancedObjects(worldRoot, model, placements.map((placement) => toInstancedPlacement(placement, correction)), true);
  }));
}

function addScaleEntry(group: Group, node: Object3D, cursor: { value: number }, label: string, scale: number, info: string[]): void {
  const rawBox = new Box3().setFromObject(node);
  const rawSize = rawBox.getSize(new Vector3());
  node.scale.multiplyScalar(scale);
  node.updateMatrixWorld(true);
  const box = new Box3().setFromObject(node);
  const worldSize = box.getSize(new Vector3());
  const width = Math.max(box.max.x - box.min.x, 0.6);
  node.position.x = cursor.value - box.min.x;
  node.position.y = -box.min.y;
  node.position.z = -((box.min.z + box.max.z) * 0.5);
  group.add(node);
  cursor.value += width + 1.8;
  info.push(`${label}: raw ${rawSize.x.toFixed(2)}×${rawSize.y.toFixed(2)}×${rawSize.z.toFixed(2)}m → scale ×${scale.toFixed(3)} → world ${worldSize.x.toFixed(2)}×${worldSize.y.toFixed(2)}×${worldSize.z.toFixed(2)}m`);
}

async function buildScaleReference(): Promise<void> {
  const floor = new Mesh(new PlaneGeometry(34, 10), new MeshStandardMaterial({ color: 0xdce7d5, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.03;
  scaleRoot.add(floor);
  const cursor = { value: -16.0 };
  const startCursor = cursor.value;
  const info: string[] = [];
  const entries = [
    { modelId: PLAYER_CHARACTER_ASSET.modelId, label: "character.player_farmer", scale: "CHARACTER" as const },
    { modelId: "tree_broad_3", label: "tree_broad_3", scale: "ENVIRONMENT" as const },
    { modelId: "tree_pine_2", label: "tree_pine_2", scale: "ENVIRONMENT" as const },
    { modelId: "__procedural:FARMHOUSE", label: "buildFarmhouse()", scale: "FARMHOUSE" as const },
    { modelId: "farm.barn.t1", label: "farm.barn.t1", scale: "BARN" as const }
  ];
  for (const entry of entries) {
    let node: Object3D | null = null;
    if (entry.scale === "FARMHOUSE") {
      node = buildLandmarkNode(assets, "FARMHOUSE", "", () => undefined);
    } else {
      const source = await library.load(entry.modelId);
      node = source?.clone(true) ?? null;
      if (node === null) errors.push(`scale reference missing: ${entry.modelId}`);
    }
    if (node === null) continue;
    let scale = 1;
    if (entry.scale === "CHARACTER") {
      const rawHeight = modelHeight(node);
      scale = characterVisualScale(PLAYER_CHARACTER_ASSET, rawHeight);
    } else if (entry.modelId.startsWith("tree_")) {
      scale = treeScaleCorrections.get(entry.modelId) ?? 1;
    } else if (entry.scale === "BARN") {
      scale = 4.6;
    }
    addScaleEntry(scaleRoot, node, cursor, entry.label, scale, info);
  }
  scaleRoot.position.x = -(startCursor + cursor.value) * 0.5;
  scaleInfo.textContent = `Cùng camera, cùng mặt đất, không fit riêng từng model.\n${info.join("\n")}`;
}

function updateLabels(): void {
  if (!labelsToggle.checked || !worldRoot.visible) {
    labelElements.forEach(({ element }) => { element.hidden = true; });
    return;
  }
  const rect = canvas.getBoundingClientRect();
  labelElements.forEach(({ label, element }) => {
    const projected = new Vector3(label.x, terrainY(label.x, label.z, label.y), label.z).project(camera);
    const visible = projected.z > -1 && projected.z < 1 && projected.x > -1.1 && projected.x < 1.1 && projected.y > -1.1 && projected.y < 1.1;
    element.hidden = !visible;
    if (!visible) return;
    element.style.left = `${String((projected.x * 0.5 + 0.5) * rect.width)}px`;
    element.style.top = `${String((-projected.y * 0.5 + 0.5) * rect.height)}px`;
  });
}

function updateMetrics(): void {
  const treeCount = layout.placements.filter((placement) => placement.group.startsWith("FOREST_")).length;
  const propCount = layout.placements.filter((placement) => !placement.group.startsWith("FOREST_") && placement.group !== "HOUSE" && placement.group !== "WAREHOUSE" && placement.group !== "DOCK").length;
  const values = [String(treeCount), String(propCount), String(renderer.info.render.calls), String(renderer.info.render.triangles), String(layout.seed)];
  metricValues.forEach((element, index) => { element.textContent = values[index] ?? "—"; });
}

function render(): void {
  if (document.visibilityState === "hidden") return;
  renderer.info.reset();
  renderer.render(scene, camera);
  updateLabels();
  updateMetrics();
}

function setPreset(name: keyof typeof presets): void {
  const preset = presets[name];
  const isScale = name === "scale";
  worldRoot.visible = !isScale;
  scaleRoot.visible = isScale;
  scaleInfo.hidden = !isScale;
  camera.position.copy(preset.position);
  controls.target.copy(preset.target);
  controls.update();
  render();
}

function resize(): void {
  const rect = viewport.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  render();
}

document.querySelector<HTMLButtonElement>("#overview")?.addEventListener("click", () => { setPreset("overview"); });
document.querySelector<HTMLButtonElement>("#dock")?.addEventListener("click", () => { setPreset("dock"); });
document.querySelector<HTMLButtonElement>("#yard")?.addEventListener("click", () => { setPreset("yard"); });
document.querySelector<HTMLButtonElement>("#scale")?.addEventListener("click", () => { setPreset("scale"); });
document.querySelector<HTMLButtonElement>("#download")?.addEventListener("click", () => {
  const anchor = document.createElement("a");
  anchor.href = renderer.domElement.toDataURL("image/png");
  anchor.download = `moc-island-preview-${worldRoot.visible ? "world" : "scale"}.png`;
  anchor.click();
});
labelsToggle.addEventListener("change", render);
controls.addEventListener("change", render);
window.addEventListener("resize", resize);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") render(); });

async function build(): Promise<void> {
  buildTerrain();
  buildRoads();
  addPad(2.0, 7.8, 11.0, 9.0, assets.bareEarth);
  addPad(14.0, -5.2, 11.5, 8.5, assets.bareEarth);
  buildDock();
  await buildPlacementModels();
  await buildScaleReference();
  const sun = new DirectionalLight(0xfff0cd, 2.3);
  sun.position.set(-34, 60, 28);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -90;
  sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90;
  sun.shadow.camera.bottom = -90;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 210;
  sun.shadow.bias = -0.0008;
  scene.add(new HemisphereLight(0xdcf0ff, 0x6d8f52, 0.9), new AmbientLight(0xffffff, 0.16), sun);
  resize();
  setPreset("overview");
  const dockDelta = layout.dock.oldHintDelta.toFixed(2);
  status.textContent = errors.length === 0
    ? `Preview sẵn sàng · cảnh quan mục tiêu, chưa tích hợp farm.\nBến preview lệch anchor cũ: ${dockDelta}m (chỉ ghi nhận, không sửa persisted dock).`
    : `Preview sẵn sàng với diagnostics:\n${errors.join("\n")}\nBến preview lệch anchor cũ: ${dockDelta}m.`;
  if (layout.missing.length > 0) {
    missingOutput.hidden = false;
    missingOutput.textContent = `Thiếu có chủ ý:\n${layout.missing.map((item) => `${item.id}: ${item.reason}`).join("\n")}`;
  }
}

void build().catch((error: unknown) => {
  status.classList.add("error");
  status.textContent = `PREVIEW FAILED:\n${String(error)}`;
});
