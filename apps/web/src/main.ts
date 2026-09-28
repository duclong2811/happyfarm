import type {
  CropStateDTO,
  FarmTileDTO,
  InventoryEntryDTO,
  PlayerProgressionDTO,
  ShopEntryDTO,
  WalletDTO
} from "@happy-farm/contracts";
import { ApiClient, ApiError } from "./api";
import { PLANTABLE_CROPS, cropLabel, currencyLabel, errorLabel, itemLabel } from "./labels";
import { progressionSummary } from "./progression";
import {
  buildFarmSceneInput,
  createFarmScene,
  FarmRendererUnavailableError,
  type FarmSceneHandle
} from "./render";
import "./styles.css";

const TOKEN_KEY = "happy-farm.dev.token";
const FARM_KEY = "happy-farm.dev.farmId";
const REFRESH_INTERVAL_MS = 2_000;

interface SelectedTile {
  readonly x: number;
  readonly y: number;
}

interface AppState {
  farmId: string | null;
  farmName: string;
  tiles: readonly FarmTileDTO[];
  crops: readonly CropStateDTO[];
  inventory: readonly InventoryEntryDTO[];
  shop: readonly ShopEntryDTO[];
  wallet: readonly WalletDTO[];
  progression: PlayerProgressionDTO | null;
  selected: SelectedTile | null;
  selectedCrop: string;
  status: string;
  statusIsError: boolean;
}

const state: AppState = {
  farmId: null,
  farmName: "",
  tiles: [],
  crops: [],
  inventory: [],
  shop: [],
  wallet: [],
  progression: null,
  selected: null,
  selectedCrop: PLANTABLE_CROPS[0],
  status: "Enter the development token, then bootstrap and create a farm.",
  statusIsError: false
};

// The 3D view is opt-in. Creating a WebGL context is the one thing this page cannot take back, so
// it happens on an explicit click instead of during load.
let scene: FarmSceneHandle | null = null;

// The repository typechecks with both the DOM and `@cloudflare/workers-types` libraries, which
// declare conflicting `append`/`remove` signatures. The cast keeps this tiny id lookup usable.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function element<T>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing element #${id}`);
  return found as unknown as T;
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setStatus(message: string, isError = false): void {
  state.status = message;
  state.statusIsError = isError;
  const node = element<HTMLParagraphElement>("status");
  node.textContent = message;
  node.classList.toggle("error", isError);
}

function token(): string {
  return element<HTMLInputElement>("token").value.trim();
}

function api(): ApiClient {
  return new ApiClient(token());
}

function newRequestId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function describe(error: unknown): string {
  if (error instanceof ApiError) return errorLabel(error.code);
  if (error instanceof Error) return error.message;
  return String(error);
}

function selectedTile(): FarmTileDTO | null {
  const selected = state.selected;
  if (selected === null) return null;
  return state.tiles.find((tile) => tile.x === selected.x && tile.y === selected.y) ?? null;
}

function cropAt(x: number, y: number): CropStateDTO | null {
  return state.crops.find((crop) => crop.tileX === x && crop.tileY === y) ?? null;
}

function renderFarm(): void {
  const info = element<HTMLParagraphElement>("farm-info");
  if (state.farmId === null) {
    info.textContent = "No farm loaded.";
    return;
  }
  info.textContent = `${state.farmName} · ${state.farmId} · ${String(state.tiles.length)} unlocked tiles`;
}

function renderWallet(): void {
  const node = element<HTMLParagraphElement>("wallet");
  if (state.wallet.length === 0) {
    node.textContent = "0 gold";
    return;
  }
  node.textContent = state.wallet
    .map((entry) => `${String(entry.balance)} ${currencyLabel(entry.currencyId).toLowerCase()}`)
    .join(" · ");
}

function renderProgression(): void {
  const node = element<HTMLDivElement>("progression");
  node.replaceChildren();
  const progression = state.progression;
  if (progression === null) {
    node.appendChild(make("p", "muted", "Sign in to load levelling state."));
    return;
  }
  // The bar's width is the only value on this page the server does not send; it is the fraction the
  // server already derived, turned into pixels. No level or threshold is recomputed here.
  const summary = progressionSummary(progression);
  node.appendChild(make("p", "big", summary.title));
  const bar = make("div", "xp-bar");
  const fill = make("div", "xp-fill");
  fill.style.width = `${String(Math.round(summary.fraction * 100))}%`;
  bar.appendChild(fill);
  node.appendChild(bar);
  node.appendChild(make("p", "muted", summary.detail));
}

function renderSelection(): void {
  const node = element<HTMLSpanElement>("selection");
  const tile = selectedTile();
  if (tile === null) {
    node.textContent = "No tile selected.";
    return;
  }
  const crop = cropAt(tile.x, tile.y);
  node.textContent =
    crop === null
      ? `Selected (${String(tile.x)}, ${String(tile.y)}) · ${tile.terrainType} · version ${String(tile.version)}`
      : `Selected (${String(tile.x)}, ${String(tile.y)}) · ${cropLabel(crop.definitionId)}`;
}

function tileNode(tile: FarmTileDTO): HTMLDivElement {
  const crop = cropAt(tile.x, tile.y);
  const node = make("div", "tile");
  const selected = state.selected;
  const isSelected = selected !== null && selected.x === tile.x && selected.y === tile.y;
  node.classList.toggle("selected", isSelected);
  if (crop !== null) node.classList.add(crop.mature ? "mature" : "growing");
  if (tile.terrainType !== "SOIL") node.classList.add("blocked");
  node.tabIndex = 0;
  node.appendChild(make("span", "coords", `${String(tile.x)},${String(tile.y)}`));

  if (crop === null) {
    node.appendChild(make("span", "crop", tile.terrainType === "SOIL" ? "empty" : tile.terrainType));
  } else {
    node.appendChild(make("span", "crop", cropLabel(crop.definitionId)));
    if (crop.mature) {
      node.appendChild(make("span", "state", "ready"));
      const harvest = make("button", "mini", "Harvest");
      harvest.addEventListener("click", (event) => {
        event.stopPropagation();
        void harvestCrop(crop.cropInstanceId, crop.version);
      });
      node.appendChild(harvest);
    } else {
      node.appendChild(
        make("span", "state", `${String(Math.round(crop.growthProgress * 100))}% · stage ${String(crop.growthStage)}`)
      );
    }
  }

  const select = (): void => {
    selectTile(tile.x, tile.y);
  };
  node.addEventListener("click", select);
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") select();
  });
  return node;
}

function renderField(): void {
  const container = element<HTMLDivElement>("field");
  container.replaceChildren();
  if (state.farmId === null) {
    container.appendChild(make("p", "muted", "Create or load a farm to see its unlocked land."));
    return;
  }
  if (state.tiles.length === 0) {
    container.appendChild(make("p", "muted", "This farm has no unlocked tiles yet."));
    return;
  }
  const grid = make("div", "grid");
  for (const tile of [...state.tiles].sort((a, b) => a.y - b.y || a.x - b.x)) {
    grid.appendChild(tileNode(tile));
  }
  container.appendChild(grid);
}

function renderInventory(): void {
  const list = element<HTMLUListElement>("inventory");
  list.replaceChildren();
  if (state.inventory.length === 0) {
    list.appendChild(make("li", "muted", "Empty"));
    return;
  }
  for (const entry of state.inventory) {
    list.appendChild(
      make("li", undefined, `${itemLabel(entry.itemDefinitionId)} × ${String(entry.quantity)}`)
    );
  }
}

function renderShop(): void {
  const container = element<HTMLDivElement>("shop");
  container.replaceChildren();
  if (state.shop.length === 0) {
    container.appendChild(make("p", "muted", "Sign in to load the shop."));
    return;
  }
  for (const entry of state.shop) {
    const row = make("div", "shop-row");
    row.appendChild(
      make(
        "span",
        "shop-item",
        `${itemLabel(entry.itemDefinitionId)} · buy ${String(entry.buyPrice)} / sell ${String(entry.sellPrice)} ${currencyLabel(entry.currencyId).toLowerCase()}`
      )
    );
    const quantity = make("input");
    quantity.type = "number";
    quantity.min = "1";
    quantity.max = String(entry.maxQuantityPerRequest);
    quantity.value = "1";
    quantity.className = "quantity";
    row.appendChild(quantity);
    const buy = make("button", undefined, "Buy");
    buy.addEventListener("click", () => {
      void trade("buy", entry.shopEntryId, quantity.valueAsNumber);
    });
    const sell = make("button", undefined, "Sell");
    sell.addEventListener("click", () => {
      void trade("sell", entry.shopEntryId, quantity.valueAsNumber);
    });
    row.appendChild(buy);
    row.appendChild(sell);
    container.appendChild(row);
  }
}

function render(): void {
  renderFarm();
  renderWallet();
  renderProgression();
  renderField();
  renderSelection();
  renderInventory();
  renderShop();
}

async function refreshAccount(): Promise<void> {
  const client = api();
  const [inventory, wallet, shop, progression] = await Promise.all([
    client.getInventory(),
    client.getWallet(),
    client.getShop(),
    client.getProgression()
  ]);
  state.inventory = inventory.items;
  state.wallet = wallet.wallets;
  state.shop = shop.entries;
  state.progression = progression.progression;
}

function setSceneState(text: string): void {
  element<HTMLSpanElement>("render-3d-state").textContent = text;
}

/** Applies a selection from either the 2D grid or the 3D view; both read and write this one state. */
function selectTile(x: number, y: number): void {
  state.selected = { x, y };
  renderField();
  renderSelection();
  refreshScene();
}

/** Pushes authoritative farm state into the renderer. The renderer invents no land and no crops. */
function refreshScene(): void {
  if (scene === null) return;
  try {
    scene.setState(
      buildFarmSceneInput({ tiles: state.tiles, crops: state.crops, selected: state.selected })
    );
  } catch (error: unknown) {
    // The 3D view is a projection of state the rest of the page owns. A renderer problem must not
    // abort the authoritative refresh that called this, because the 2D field and the polling that
    // keeps it current do not depend on the 3D view working.
    setSceneState(`Renderer error: ${describe(error)}`);
    return;
  }
  setSceneState(
    `Renderer active (${String(state.tiles.length)} tiles, ${String(state.crops.length)} crops).`
  );
}

function enable3D(): void {
  try {
    scene ??= createFarmScene(element<HTMLCanvasElement>("scene"), {
      onTileSelected: (coordinate) => {
        selectTile(coordinate.x, coordinate.y);
      },
      onAssetProblem: (assetId, error) => {
        // The crop keeps its placeholder art, so this is information rather than a failure the page
        // has to recover from. Reported on the main status line because the scene status is
        // rewritten by the next refresh.
        setStatus(`${assetId} model unavailable, using placeholder art: ${describe(error)}`, true);
      }
    });
    refreshScene();
    setStatus("3D view ready.");
  } catch (error: unknown) {
    if (error instanceof FarmRendererUnavailableError) {
      setSceneState("Unavailable.");
      setStatus("This browser session has no WebGL context, so the 3D view cannot start.", true);
      return;
    }
    setStatus(describe(error), true);
  }
}

async function refreshFarm(): Promise<void> {
  if (state.farmId === null) return;
  const client = api();
  const [tiles, crops] = await Promise.all([client.getTiles(state.farmId), client.getCrops(state.farmId)]);
  state.tiles = tiles.tiles;
  state.crops = crops.crops;
  refreshScene();
}

async function loadFarm(farmId: string): Promise<void> {
  const client = api();
  const result = await client.getFarm(farmId);
  state.farmId = result.farm.id;
  state.farmName = result.farm.name;
  // A coordinate selected on the previous farm means nothing here, and clearing it matches what
  // creating a farm already does.
  state.selected = null;
  localStorage.setItem(FARM_KEY, result.farm.id);
  element<HTMLInputElement>("load-farm-id").value = result.farm.id;
  await refreshFarm();
  await refreshAccount();
}

async function bootstrap(): Promise<void> {
  const client = api();
  const result = await client.bootstrap();
  setStatus(
    `Dev player ${result.player.playerId} is ${result.player.status}${result.player.created ? " (created)" : " (already existed)"}.`
  );
}

async function createFarm(): Promise<void> {
  const client = api();
  const name = element<HTMLInputElement>("farm-name").value;
  const created = await client.createFarm(name);
  state.farmId = created.farm.id;
  state.farmName = created.farm.name;
  state.selected = null;
  localStorage.setItem(FARM_KEY, created.farm.id);
  element<HTMLInputElement>("load-farm-id").value = created.farm.id;
  await refreshFarm();
  await refreshAccount();
  setStatus(`Created ${created.farm.name} with ${String(state.tiles.length)} unlocked tiles.`);
}

async function plant(): Promise<void> {
  const tile = selectedTile();
  if (state.farmId === null || tile === null) {
    setStatus("Select a tile first.", true);
    return;
  }
  if (cropAt(tile.x, tile.y) !== null) {
    setStatus("That tile already has a crop.", true);
    return;
  }
  const client = api();
  await client.plantCrop(state.farmId, {
    requestId: newRequestId("plant"),
    cropDefinitionId: state.selectedCrop,
    x: tile.x,
    y: tile.y,
    expectedTileVersion: tile.version
  });
  await refreshFarm();
  await refreshAccount();
  setStatus(`Planted ${cropLabel(state.selectedCrop)} on (${String(tile.x)}, ${String(tile.y)}).`);
}

async function harvestCrop(cropInstanceId: string, expectedCropVersion: number): Promise<void> {
  if (state.farmId === null) return;
  const client = api();
  const result = await client.harvestCrop(state.farmId, cropInstanceId, {
    requestId: newRequestId("harvest"),
    expectedCropVersion
  });
  await refreshFarm();
  await refreshAccount();
  // Levelling state comes from the refresh, not from the award, so the page and the server agree
  // even if another harvest landed in between. The award is used for the message only.
  setStatus(
    `Harvested ${String(result.harvest.quantityAdded)} × ${itemLabel(result.harvest.itemDefinitionId)} · +${String(result.progression.xpAwarded)} XP${result.progression.leveledUp ? ` · reached level ${String(result.progression.progression.level)}` : ""}.`
  );
}

async function trade(direction: "buy" | "sell", shopEntryId: string, quantity: number): Promise<void> {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    setStatus("Quantity must be a positive whole number.", true);
    return;
  }
  const client = api();
  const body = { requestId: newRequestId(direction), shopEntryId, quantity };
  const result = direction === "buy" ? await client.buy(body) : await client.sell(body);
  const settlement = result.settlement;
  await refreshAccount();
  const moved = "amountSpent" in settlement ? settlement.amountSpent : settlement.amountReceived;
  setStatus(`${direction === "buy" ? "Bought" : "Sold"} ${String(quantity)} for ${String(moved)} gold → ${String(settlement.newBalance)} gold.`);
}

async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error: unknown) {
    setStatus(describe(error), true);
  }
  render();
}

function wire(): void {
  const storedToken = localStorage.getItem(TOKEN_KEY);
  if (storedToken !== null) element<HTMLInputElement>("token").value = storedToken;
  const storedFarm = localStorage.getItem(FARM_KEY);
  if (storedFarm !== null) element<HTMLInputElement>("load-farm-id").value = storedFarm;

  const cropSelect = element<HTMLSelectElement>("crop-select");
  for (const definitionId of PLANTABLE_CROPS) {
    const option = document.createElement("option");
    option.value = definitionId;
    option.textContent = cropLabel(definitionId);
    cropSelect.appendChild(option);
  }
  cropSelect.addEventListener("change", () => {
    state.selectedCrop = cropSelect.value;
  });

  element<HTMLButtonElement>("save-token").addEventListener("click", () => {
    localStorage.setItem(TOKEN_KEY, token());
    setStatus("Token stored in this browser only.");
  });
  element<HTMLButtonElement>("bootstrap").addEventListener("click", () => {
    void run(bootstrap);
  });
  element<HTMLButtonElement>("create-farm").addEventListener("click", () => {
    void run(createFarm);
  });
  element<HTMLButtonElement>("load-farm").addEventListener("click", () => {
    const requested = element<HTMLInputElement>("load-farm-id").value.trim();
    void run(async () => {
      await loadFarm(requested);
      setStatus(`Loaded ${state.farmName}.`);
    });
  });
  element<HTMLButtonElement>("refresh").addEventListener("click", () => {
    void run(async () => {
      await refreshFarm();
      await refreshAccount();
      setStatus("Refreshed from the server.");
    });
  });
  element<HTMLButtonElement>("plant").addEventListener("click", () => {
    void run(plant);
  });
  element<HTMLButtonElement>("render-3d").addEventListener("click", enable3D);
  // A page restored from the back/forward cache would otherwise return with a disposed renderer and
  // a blank canvas, so the handle is dropped and the button starts a fresh one.
  window.addEventListener("pagehide", () => {
    scene?.dispose();
    scene = null;
    setSceneState("Renderer idle.");
  });

  window.setInterval(() => {
    if (state.farmId === null || token().length === 0) return;
    void (async () => {
      try {
        await refreshFarm();
        render();
      } catch {
        // Growth polling is best-effort; explicit actions surface their own errors.
      }
    })();
  }, REFRESH_INTERVAL_MS);
}

wire();
render();
void run(async () => {
  if (localStorage.getItem(FARM_KEY) === null || token().length === 0) return;
  await loadFarm(localStorage.getItem(FARM_KEY) ?? "");
  setStatus("Reloaded the last farm.");
});
