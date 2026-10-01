/**
 * The client's one translation layer.
 *
 * Everything a player can read in the HUD goes through here: panel titles, buttons, selection states,
 * countdowns, shop and inventory rows, wallet and level text, success and error messages, and the
 * uproot confirmation. Nothing about the game is decided here -- the level, the prices, the crop
 * list, and maturity all come from the server -- this module only decides what language to say them
 * in.
 *
 * Crop, item, and currency names are *not* listed in code. The server sends the game-data display
 * key with each row and this module looks it up, so a definition added to game data appears in the
 * catalogue immediately and is only untranslated, never missing.
 */

export type Language = "vi" | "en";

export const DEFAULT_LANGUAGE: Language = "en";
export const LANGUAGE_STORAGE_KEY = "happy-farm.language";

/** Language codes the switch offers, in the order it cycles through them. */
export const LANGUAGES: readonly Language[] = ["en", "vi"];

const LANGUAGE_TAGS: Record<Language, string> = { en: "en", vi: "vi" };

export type TranslateParams = Readonly<Record<string, string | number>>;
export type Translate = (key: MessageKey, params?: TranslateParams) => string;

export interface LanguageStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isLanguage(value: string | null | undefined): value is Language {
  return value === "en" || value === "vi";
}

/**
 * Which language to start in.
 *
 * A saved choice wins. Otherwise the browser's language decides, and anything that is not Vietnamese
 * reads as English -- the contract is total, so there is no third state to handle later. The check
 * is case-insensitive and looks only at the leading tag, so `vi`, `vi-VN`, and `VI-vn` all count.
 */
export function detectLanguage(saved: string | null, navigatorLanguage: string | null): Language {
  if (isLanguage(saved)) return saved;
  if (typeof navigatorLanguage === "string" && navigatorLanguage.toLowerCase().startsWith("vi")) {
    return "vi";
  }
  return DEFAULT_LANGUAGE;
}

export function readStoredLanguage(storage: LanguageStorage): Language | null {
  let value: string | null = null;
  try {
    value = storage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    // A blocked or full localStorage must not stop the game from loading; the browser language wins.
    return null;
  }
  return isLanguage(value) ? value : null;
}

export function storeLanguage(storage: LanguageStorage, language: Language): void {
  try {
    storage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Persisting the choice is a convenience; failing to persist it is not an error worth surfacing.
  }
}

/** The `<html lang>` value for a language, so screen readers follow the switch. */
export function languageTag(language: Language): string {
  return LANGUAGE_TAGS[language];
}

/** The other language, which is what the toggle button shows as its action. */
export function otherLanguage(language: Language): Language {
  return language === "en" ? "vi" : "en";
}

export function interpolate(template: string, params: TranslateParams = {}): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

const EN_MESSAGES = {
  "language.label": "Language",
  "language.switch": "Tiếng Việt",
  "hud.gold": "Gold",
  "hud.refresh": "Refresh farm",
  "hud.modules": "Farm modules",
  "hud.starting": "Starting the local development farm…",
  "panel.inventory": "Inventory",
  "panel.land": "Land",
  "panel.market": "Farm Market",
  "panel.build": "Build",
  "panel.bag": "Bag",
  "panel.close": "Close",
  "panel.collapse": "Collapse the bag and land panel",
  "panel.expand": "Open the bag and land panel",
  "market.tab": "Market",
  "market.quantity": "Quantity",
  "market.decrease": "One fewer",
  "market.increase": "One more",
  "market.noBuy": "Nothing is for sale here right now.",
  "market.noSell": "Nothing in your store can be sold right now.",
  "market.collapse": "Collapse the market",
  "market.expand": "Open the market",
  "dock.go": "Go",
  "dock.goTitle": "Walk to the selected tile",
  "dock.crop": "Crop",
  "dock.plant": "Plant crop",
  "dock.harvest": "Harvest",
  "dock.uproot": "Uproot",
  "dock.uproot.confirm": "Uproot this crop? The seed will not be refunded.",
  "dock.seedCount": "{count} seeds",
  "dock.locked": "level {level}",
  "dock.noSeed": "You have no {seed} to plant. Buy more in the Farm Market.",
  "land.unlock": "Unlock next plot",
  "land.load": "Load a farm to see available land.",
  "land.next": "Next: plot {index} · {price} {currency} · level {level}",
  "land.all": "All available plots are unlocked.",
  "farm.none": "No farm loaded.",
  "farm.info": "{name} · {farmId} · {tiles} unlocked tiles",
  "wallet.none": "0 gold",
  "progression.signedOut": "Sign in to load levelling state.",
  "progression.level": "Level {level}",
  "progression.toNext": "{into} / {span} XP to level {next}",
  "progression.cap": "{xp} XP · highest level",
  "inventory.empty": "Empty",
  "inventory.line": "{item} × {quantity}",
  "market.signedOut": "Sign in to load the shop.",
  "build.categories": "Build categories",
  "build.empty": "Nothing in this category yet.",
  "build.catalogOnly":
    "A catalogue, not a shop: these are what the island allows. Placing them arrives with the construction pass.",
  "build.locked": "Locked",
  "build.available": "Available",
  "build.levelShort": "Lv {level}",
  "build.status.ready": "{item} ready to place - click a cell. Esc cancels.",
  "build.status.selected": "{item} selected — press Place to position it.",
  "build.status.blocked": "{item}: {reason}",
  "build.thumbnailProblem": "One asset could not be drawn as a thumbnail ({model}).",
  "build.reason.noCell": "no cell selected",
  "build.reason.outsideIsland": "that is off the island",
  "build.reason.wrongGround": "wrong ground for this",
  "build.reason.unsuitable": "this ground cannot hold it",
  "build.reason.occupied": "something is already there",
  "build.reason.reserved": "that ground is not yours yet",
  "status.placing": "Placing {item} at {at}. Click another cell to move it, Esc to cancel.",
  "status.placingBlocked": "{item} cannot go there: {reason}. Click another cell, or Esc to cancel.",
  "status.placingPickCell": "an unselected cell",
  "status.placementCancelled": "Placement cancelled. Nothing was built.",

  // ---- The construction shop, V12.5 ------------------------------------------------
  "build.search": "Search items",
  "build.searchPlaceholder": "Search items…",
  "build.searchEmpty": "Nothing here matches that search.",
  "build.filter.all": "All",
  "build.filter.available": "Available",
  "build.filter.locked": "Locked",
  "build.inspector.none": "Pick an item to see what it is, what it costs, and where it can go.",
  "build.inspector.price": "Price",
  "build.inspector.cost": "Cost",
  "build.inspector.perCells": "{cells} cells",
  "build.inspector.level": "Level",
  "build.inspector.footprint": "Footprint",
  "build.inspector.cells": "{width} × {depth} cells",
  "build.inspector.tier": "Tier",
  "build.inspector.upgrade": "Upgrade",
  "build.inspector.upgradeTo": "Upgrades to {item}",
  "build.levelFull": "Level {level}",
  "build.unlocksAt": "Unlocks at Level {level}",
  "build.previewOnly": "Preview only — cannot be built yet",
  "build.lockedAt": "Locked — Level {level}",
  "build.place": "Place",
  "build.validLocation": "Valid location",
  "build.cannotPlace": "Cannot place here: {reason}",
  "build.notRotatable": "This one cannot be turned.",
  "build.hud.rotate": "Rotate",
  "build.hud.move": "Move the preview",
  "build.hud.cancel": "Cancel",
  "build.hud.clickKey": "Left click",
  "build.hud.previewNote": "Preview only for now — nothing is built until the construction pass.",

  // ---- What the things are called, and what they are for --------------------------
  "road.dirt.name": "Dirt Road",
  "road.gravel.name": "Gravel Road",
  "road.stone.name": "Stone Road",
  "road.paved.name": "Paved Road",
  "place.road.description": "A road segment for connecting parts of your island.",
  "place.tree_broad.name": "Broadleaf Tree",
  "place.tree_broad.description": "A broad, leafy tree for landscaping your island.",
  "place.tree_pine.name": "Pine Tree",
  "place.tree_pine.description": "A tall evergreen tree for landscaping your island.",
  "place.bush_leafy.name": "Leafy Bush",
  "place.bush_leafy.description": "A low leafy shrub for borders and gardens.",
  "place.bush_flowering.name": "Flowering Bush",
  "place.bush_flowering.description": "A flowering shrub that adds colour to a garden.",
  "place.flower_group.name": "Wildflowers",
  "place.flower_group.description": "A patch of wildflowers for brightening open ground.",
  "place.plant_clover.name": "Clover Patch",
  "place.plant_clover.description": "Low clover ground cover for lawns and paths.",
  "place.plant_fern.name": "Fern",
  "place.plant_fern.description": "A shade-loving fern for damp, sheltered corners.",
  "place.plant_grass.name": "Tall Grass",
  "place.plant_grass.description": "A tuft of tall grass for natural edges.",
  "place.rock_small.name": "Small Landscape Rock",
  "place.rock_small.description": "A small stone for garden detail.",
  "place.rock_large.name": "Large Landscape Rock",
  "place.rock_large.description": "A large stone that anchors a garden or a wild corner.",
  "place.fence_rail.name": "Wooden Fence",
  "place.fence_rail.description": "A short wooden fence to mark a field or a garden.",
  "place.fence_rail_long.name": "Long Wooden Fence",
  "place.fence_rail_long.description": "A long wooden fence for marking larger fields.",
  "place.barrel.name": "Barrel",
  "place.barrel.description": "A wooden barrel for storing goods on the farm.",
  "place.crate.name": "Wooden Crate",
  "place.crate.description": "A wooden crate for storing and moving goods.",
  "place.sack.name": "Sack",
  "place.sack.description": "A sack of farm goods, ready for market.",
  "place.planter.name": "Planter",
  "place.planter.description": "A raised planter for growing beside the house.",
  "place.bench.name": "Wooden Bench",
  "place.bench.description": "A bench to rest on, and to make a yard feel lived in.",
  "place.wagon.name": "Handcart",
  "place.wagon.description": "A handcart for carrying goods around the farm.",
  "place.stall.name": "Market Stall",
  "place.stall.description": "A market stall where the village sells its produce.",
  "place.well.name": "Stone Well",
  "place.well.description": "A stone well, the old centre of a village square.",
  "place.lantern.name": "Lantern Post",
  "place.lantern.description": "A lantern post to light paths after dark.",
  "place.workbench.name": "Workbench",
  "place.workbench.description": "A workbench for repairs and small farm projects.",
  "place.fish_cage.name": "Fish Cage",
  "place.fish_cage.description": "A cage for raising fish in island waters.",
  "place.barn_t1.name": "Barn",
  "place.barn_t1.description": "Stores farm goods and supports agricultural development.",
  "place.barn_t2.name": "Large Barn",
  "place.barn_t2.description": "A bigger barn for a farm that has outgrown its first one.",
  "place.barn_t3.name": "Grand Barn",
  "place.barn_t3.description": "The estate's main store: room for a whole island's harvest.",
  "place.coop.name": "Chicken Coop",
  "place.coop.description": "Houses poultry, and the first step towards livestock.",
  "place.open_barn.name": "Open Barn",
  "place.open_barn.description": "An open-sided barn for sheltering animals and equipment.",
  "place.silo.name": "Grain Silo",
  "place.silo.description": "A grain silo for storing the farm's harvest.",
  "place.silo_house.name": "Silo House",
  "place.silo_house.description": "A silo with a farmhouse built against it.",
  "place.windmill.name": "Windmill",
  "place.windmill.description": "A windmill for milling grain into flour.",
  "build.requiresLevel": "Unlocks at level {level}",
  "build.tier": "Tier {tier}",
  "build.preview": "Preview",
  "build.category.road": "Roads",
  "build.category.vegetation": "Planting",
  "build.category.decoration": "Decoration",
  "build.category.fence": "Fences",
  "build.category.lighting": "Lighting",
  "build.category.utility": "Utility",
  "build.category.waterfront": "Waterfront",
  "build.category.building": "Buildings",
  "build.category.monument": "Monuments",
  "market.buy": "Buy",
  "market.sell": "Sell",
  "market.line": "{item} · {price}",
  "field.load": "Create or load a farm to see its unlocked land.",
  "field.none": "This farm has no unlocked tiles yet.",
  "field.empty": "empty",
  "field.ready": "ready",
  "field.stage": "{percent}% · stage {stage}",
  "field.tile": "{x},{y}",
  "selection.none.title": "Click a field tile",
  "selection.none.detail": "Choose a tile to plant or harvest.",
  "selection.missing.title": "Selected {at} is not unlocked land",
  "selection.missing.detail": "Pick an unlocked tile.",
  "cell.land.title": "Selected cell: {land}",
  "cell.actions.detail": "Available: {actions}",
  "cell.land.farmland": "farmland",
  "cell.land.agriculture": "agricultural land",
  "cell.land.forestry": "managed woodland",
  "cell.land.mining": "quarry reserve",
  "cell.land.civic": "settlement",
  "cell.land.wild": "wild land",
  "cell.land.water": "water",
  "cell.land.aquaculture": "aquaculture water",
  "cell.land.shore": "shore",
  "cell.land.road": "road",
  "cell.land.building": "a building",
  "cell.land.open": "open ground",
  "cell.action.move": "move",
  "cell.action.plant": "plant",
  "cell.action.harvest": "harvest",
  "cell.action.uproot": "remove",
  "cell.action.timber": "logging",
  "cell.action.mine": "quarrying",
  "cell.action.aquaculture": "fishing",
  "selection.empty.title": "Selected {at} · {terrain} · empty",
  "selection.empty.detail": "Choose a crop, then plant it here.",
  "selection.empty.locked": "That crop needs level {level} of the player.",
  "selection.empty.noSeed": "You have no {seed} to plant. Buy more in the Farm Market.",
  "selection.empty.terrain": "This terrain cannot be planted.",
  "selection.growing.title": "Selected {at} · {crop} · growing",
  "selection.growing.detail": "Growing · {percent}% · {time}",
  "selection.mature.title": "Selected {at} · {crop} · ready to harvest",
  "selection.mature.detail": "Harvest it to collect the produce and XP.",
  "terrain.GRASS": "grass",
  "terrain.SOIL": "soil",
  "terrain.WATER": "water",
  "terrain.BLOCKED": "locked",
  "terrain.unknown": "unknown",
  "time.seconds": "{count}s left",
  "time.minutes": "{count}m left",
  "time.minutesSeconds": "{minutes}m {seconds}s left",
  "time.hours": "{count}h left",
  "time.hoursMinutes": "{hours}h {minutes}m left",
  "time.days": "{count}d left",
  "time.daysHours": "{days}d {hours}h left",
  "time.readySoon": "ready any moment",
  "time.unknown": "growth time unavailable",
  "scene.prepare": "Preparing 3D world…",
  "scene.idle": "Renderer idle.",
  "scene.unavailable": "Unavailable.",
  "scene.active": "Renderer active ({tiles} tiles, {crops} crops).",
  "scene.error": "Renderer error: {message}",
  "scene.ready": "3D view ready. Walk with W, A, S, D or the arrow keys, drag to move the camera, and use the wheel to zoom.",
  "scene.noWebgl": "This browser session has no WebGL context, so the 3D view cannot start.",
  "scene.assetProblem": "{asset} model unavailable, using placeholder art: {message}",
  "status.refreshed": "Refreshed from the server.",
  "status.loaded": "Starter Farm loaded. Select a tile to begin.",
  "status.created": "Starter Farm created. Select a tile to begin.",
  "status.createdDetail": "Created {name} with {tiles} unlocked tiles.",
  "status.selectTile": "Select a tile first.",
  "status.noCrop": "No crop is available to plant yet.",
  "status.occupied": "That tile already has a crop.",
  "status.planted": "Planted {crop} on ({x}, {y}).",
  "status.harvested": "Harvested {quantity} × {item} · +{xp} XP",
  "status.levelUp": " · reached level {level}",
  "status.bought": "Bought {quantity} for {amount} {currency} → {balance} {currency}.",
  "status.sold": "Sold {quantity} for {amount} {currency} → {balance} {currency}.",
  "status.expanded": "Unlocked plot {index} with {tiles} tiles for {amount} {currency}.",
  "status.uprooted": "Uprooted the crop on ({x}, {y}).",
  "status.loadFarm": "Load a farm first.",
  "status.selectMature": "Select a mature crop to harvest.",
  "status.quantity": "Quantity must be a positive whole number.",
  "status.going": "Walking to{at}.",
  "error.INSUFFICIENT_FUNDS": "Not enough gold for that purchase.",
  "error.INSUFFICIENT_ITEMS": "You do not have enough of that item.",
  "error.CROP_NOT_MATURE": "That crop is still growing.",
  "error.CROP_ALREADY_HARVESTED": "That crop was already harvested.",
  "error.CROP_NOT_FOUND": "That crop is no longer there.",
  "error.CROP_LEVEL_REQUIRED": "That crop needs a higher player level.",
  "error.PLOT_LEVEL_REQUIRED": "The next plot needs a higher player level.",
  "error.PLOT_LIMIT_REACHED": "All available farm plots are already unlocked.",
  "error.TILE_OCCUPIED": "That tile is already planted.",
  "error.TILE_NOT_PLANTABLE": "That tile cannot be planted.",
  "error.CONFLICT_STALE_STATE": "The server state moved on; refresh and retry.",
  "error.IDEMPOTENCY_CONFLICT": "That request id was already used for a different action.",
  "error.REQUEST_ALREADY_PROCESSED": "That request was already processed.",
  "error.INVENTORY_LIMIT_EXCEEDED": "Inventory limit reached.",
  "error.SHOP_ENTRY_NOT_ALLOWED": "The shop does not trade that item that way.",
  "error.NOT_AUTHENTICATED": "Not authenticated: check the development token.",
  "error.NOT_AUTHORIZED": "Not allowed for this farm.",
  "error.RESOURCE_NOT_FOUND": "Not found on the server.",
  "error.INTERNAL_ERROR": "Server error.",
  "error.INVALID_INPUT": "The request was rejected as invalid.",
  "dock.tree": "Tree",
  "dock.plantTree": "Plant tree",
  "dock.removeTree": "Remove tree",
  "dock.removeTree.confirm": "Remove this tree? The sapling will not be refunded.",
  "dock.saplingCount": "{count} saplings",
  "dock.noSapling": "You have no {sapling} to plant. Buy more in the Farm Market.",
  "plant.crops": "Crops",
  "plant.trees": "Trees",
  "tree.state.GROWING": "growing",
  "tree.state.READY": "ready",
  "tree.state.REGROWING": "regrowing",
  "selection.tree.title": "Selected {at} · {tree} · {state}",
  "selection.tree.growingDetail": "Growing · {percent}% · {time}",
  "selection.tree.readyDetail": "Fruit is ready · harvest it to collect {item} and XP.",
  "selection.tree.regrowingDetail": "Regrowing · {time}",
  "selection.empty.noSapling": "You have no {sapling} to plant. Buy more in the Farm Market.",
  "selection.empty.treeLocked": "That tree needs level {level} of the player.",
  "status.plantedTree": "Planted {tree} on ({x}, {y}).",
  "status.removedTree": "Removed the tree on ({x}, {y}).",
  "status.selectReadyTree": "Select a tree with fruit ready to harvest.",
  "error.TREE_NOT_READY": "That tree's fruit is not ready yet.",
  "error.TREE_NOT_FOUND": "That tree is no longer there.",
  "error.TREE_DEFINITION_NOT_FOUND": "That tree is not available in this build.",
  "error.TREE_LEVEL_REQUIRED": "That tree needs a higher player level."
} as const;

export type MessageKey = keyof typeof EN_MESSAGES;

const VI_MESSAGES: Record<MessageKey, string> = {
  "language.label": "Ngôn ngữ",
  "language.switch": "English",
  "hud.gold": "Vàng",
  "hud.refresh": "Tải lại nông trại",
  "hud.modules": "Bảng điều khiển nông trại",
  "hud.starting": "Đang khởi động nông trại phát triển…",
  "panel.inventory": "Túi đồ",
  "panel.land": "Đất",
  "panel.market": "Chợ nông sản",
  "panel.build": "Xây dựng",
  "panel.bag": "Túi đồ",
  "panel.close": "Đóng",
  "panel.collapse": "Thu gọn túi đồ và đất",
  "panel.expand": "Mở túi đồ và đất",
  "market.tab": "Chợ",
  "market.quantity": "Số lượng",
  "market.decrease": "Bớt một",
  "market.increase": "Thêm một",
  "market.noBuy": "Hiện không có gì để mua ở đây.",
  "market.noSell": "Hiện không có gì trong kho có thể bán.",
  "market.collapse": "Thu gọn chợ",
  "market.expand": "Mở chợ",
  "dock.go": "Đi tới",
  "dock.goTitle": "Đi tới ô đã chọn",
  "dock.crop": "Cây trồng",
  "dock.plant": "Trồng cây",
  "dock.harvest": "Thu hoạch",
  "dock.uproot": "Nhổ cây",
  "dock.uproot.confirm": "Nhổ cây này? Hạt giống sẽ không được hoàn lại.",
  "dock.seedCount": "{count} hạt",
  "dock.locked": "cấp {level}",
  "dock.noSeed": "Bạn không còn {seed} để trồng. Hãy mua thêm ở Chợ nông sản.",
  "land.unlock": "Mở khoá ô đất tiếp theo",
  "land.load": "Tải nông trại để xem đất.",
  "land.next": "Tiếp theo: ô {index} · {price} {currency} · cấp {level}",
  "land.all": "Đã mở khoá toàn bộ ô đất.",
  "farm.none": "Chưa tải nông trại.",
  "farm.info": "{name} · {farmId} · {tiles} ô đất đã mở",
  "wallet.none": "0 vàng",
  "progression.signedOut": "Đăng nhập để xem cấp độ.",
  "progression.level": "Cấp {level}",
  "progression.toNext": "{into} / {span} XP để lên cấp {next}",
  "progression.cap": "{xp} XP · cấp cao nhất",
  "inventory.empty": "Trống",
  "inventory.line": "{item} × {quantity}",
  "market.signedOut": "Đăng nhập để mở chợ.",
  "build.categories": "Nhóm xây dựng",
  "build.empty": "Nhóm này chưa có gì.",
  "build.catalogOnly":
    "Đây là danh mục, không phải cửa hàng: nó cho biết hòn đảo cho phép xây gì. Việc đặt xuống sẽ đến ở bản cập nhật xây dựng.",
  "build.locked": "Chưa mở",
  "build.available": "Có thể xây",
  "build.levelShort": "Cấp {level}",
  "build.status.ready": "{item} sẵn sàng đặt - bấm vào một ô. Esc để huỷ.",
  "build.status.selected": "Đã chọn {item} — bấm Đặt xuống để xếp vào thế giới.",
  "build.status.blocked": "{item}: {reason}",
  "build.thumbnailProblem": "Không vẽ được ảnh thu nhỏ cho một vật phẩm ({model}).",
  "build.reason.noCell": "chưa chọn ô nào",
  "build.reason.outsideIsland": "vị trí ngoài đảo",
  "build.reason.wrongGround": "nền đất không phù hợp",
  "build.reason.unsuitable": "nền đất này không dùng được",
  "build.reason.occupied": "đã có vật gì đó ở đây",
  "build.reason.reserved": "đất này chưa thuộc về bạn",
  "status.placing": "Đang đặt {item} tại {at}. Bấm ô khác để dời, Esc để huỷ.",
  "status.placingBlocked": "Không thể đặt {item} ở đây: {reason}. Bấm ô khác, hoặc Esc để huỷ.",
  "status.placingPickCell": "ô chưa chọn",
  "status.placementCancelled": "Đã huỷ đặt. Chưa có gì được xây.",

  // ---- The construction shop, V12.5 ------------------------------------------------
  "build.search": "Tìm vật phẩm",
  "build.searchPlaceholder": "Tìm vật phẩm…",
  "build.searchEmpty": "Không có vật phẩm nào khớp với tìm kiếm.",
  "build.filter.all": "Tất cả",
  "build.filter.available": "Có thể xây",
  "build.filter.locked": "Chưa mở",
  "build.inspector.none": "Chọn một vật phẩm để xem nó là gì, giá bao nhiêu và đặt được ở đâu.",
  "build.inspector.price": "Giá",
  "build.inspector.cost": "Chi phí",
  "build.inspector.perCells": "{cells} ô",
  "build.inspector.level": "Cấp",
  "build.inspector.footprint": "Kích thước",
  "build.inspector.cells": "{width} × {depth} ô",
  "build.inspector.tier": "Bậc",
  "build.inspector.upgrade": "Nâng cấp",
  "build.inspector.upgradeTo": "Nâng cấp thành {item}",
  "build.levelFull": "Cấp {level}",
  "build.unlocksAt": "Mở khoá ở cấp {level}",
  "build.previewOnly": "Chỉ xem trước — chưa xây được",
  "build.lockedAt": "Chưa mở — cấp {level}",
  "build.place": "Đặt xuống",
  "build.validLocation": "Vị trí hợp lệ",
  "build.cannotPlace": "Không thể đặt ở đây: {reason}",
  "build.notRotatable": "Vật phẩm này không xoay được.",
  "build.hud.rotate": "Xoay",
  "build.hud.move": "Di chuyển bản xem trước",
  "build.hud.cancel": "Huỷ",
  "build.hud.clickKey": "Chuột trái",
  "build.hud.previewNote": "Hiện chỉ là xem trước — chưa có gì được xây cho tới bản cập nhật xây dựng.",

  // ---- What the things are called, and what they are for --------------------------
  "road.dirt.name": "Đường đất",
  "road.gravel.name": "Đường sỏi",
  "road.stone.name": "Đường đá",
  "road.paved.name": "Đường lát",
  "place.road.description": "Một đoạn đường để nối các khu vực trên đảo.",
  "place.tree_broad.name": "Cây tán rộng",
  "place.tree_broad.description": "Cây nhiều lá, tán rộng để tạo cảnh quan cho đảo.",
  "place.tree_pine.name": "Cây thông",
  "place.tree_pine.description": "Cây xanh quanh năm, thân cao, hợp làm cảnh quan.",
  "place.bush_leafy.name": "Bụi cây lá",
  "place.bush_leafy.description": "Bụi cây thấp để viền lối đi và khu vườn.",
  "place.bush_flowering.name": "Bụi cây hoa",
  "place.bush_flowering.description": "Bụi cây có hoa, thêm màu sắc cho khu vườn.",
  "place.flower_group.name": "Hoa dại",
  "place.flower_group.description": "Một cụm hoa dại làm sáng khoảng đất trống.",
  "place.plant_clover.name": "Cỏ ba lá",
  "place.plant_clover.description": "Lớp cỏ ba lá thấp cho bãi cỏ và lối đi.",
  "place.plant_fern.name": "Dương xỉ",
  "place.plant_fern.description": "Cây ưa bóng râm cho góc ẩm và khuất gió.",
  "place.plant_grass.name": "Cỏ cao",
  "place.plant_grass.description": "Một bụi cỏ cao tạo viền tự nhiên.",
  "place.rock_small.name": "Đá cảnh nhỏ",
  "place.rock_small.description": "Hòn đá nhỏ để điểm xuyết khu vườn.",
  "place.rock_large.name": "Đá cảnh lớn",
  "place.rock_large.description": "Hòn đá lớn làm điểm nhấn cho khu vườn hoặc góc hoang.",
  "place.fence_rail.name": "Hàng rào gỗ",
  "place.fence_rail.description": "Hàng rào gỗ ngắn để đánh dấu ruộng hoặc vườn.",
  "place.fence_rail_long.name": "Hàng rào gỗ dài",
  "place.fence_rail_long.description": "Hàng rào gỗ dài để quây những khoảnh ruộng lớn.",
  "place.barrel.name": "Thùng gỗ",
  "place.barrel.description": "Thùng gỗ để chứa hàng hoá trong nông trại.",
  "place.crate.name": "Hòm gỗ",
  "place.crate.description": "Hòm gỗ để cất và chuyển hàng.",
  "place.sack.name": "Bao tải",
  "place.sack.description": "Bao nông sản đã sẵn sàng ra chợ.",
  "place.planter.name": "Chậu cây",
  "place.planter.description": "Chậu trồng cây nâng cao, đặt cạnh nhà.",
  "place.bench.name": "Ghế băng gỗ",
  "place.bench.description": "Ghế băng để ngồi nghỉ, khiến sân nhà có sức sống.",
  "place.wagon.name": "Xe kéo gỗ",
  "place.wagon.description": "Xe kéo để chở hàng quanh nông trại.",
  "place.stall.name": "Sạp chợ",
  "place.stall.description": "Sạp chợ để dân làng bán nông sản.",
  "place.well.name": "Giếng đá",
  "place.well.description": "Giếng đá, trung tâm cũ của quảng trường làng.",
  "place.lantern.name": "Cột đèn lồng",
  "place.lantern.description": "Cột đèn lồng soi lối đi khi trời tối.",
  "place.workbench.name": "Bàn thợ",
  "place.workbench.description": "Bàn thợ để sửa chữa và làm việc nhỏ trong nông trại.",
  "place.fish_cage.name": "Lồng cá",
  "place.fish_cage.description": "Lồng để nuôi cá ở vùng nước quanh đảo.",
  "place.barn_t1.name": "Nhà kho",
  "place.barn_t1.description": "Chứa nông sản và mở đường cho phát triển nông nghiệp.",
  "place.barn_t2.name": "Nhà kho lớn",
  "place.barn_t2.description": "Nhà kho lớn hơn cho nông trại đã vượt qua căn đầu tiên.",
  "place.barn_t3.name": "Đại nhà kho",
  "place.barn_t3.description": "Kho chính của điền trang: đủ chỗ cho cả mùa vụ của hòn đảo.",
  "place.coop.name": "Chuồng gà",
  "place.coop.description": "Nuôi gia cầm, bước đầu tiên của chăn nuôi.",
  "place.open_barn.name": "Nhà kho mở",
  "place.open_barn.description": "Nhà kho hở mặt để che chở vật nuôi và nông cụ.",
  "place.silo.name": "Xi-lô thóc",
  "place.silo.description": "Xi-lô để trữ thóc của nông trại.",
  "place.silo_house.name": "Nhà xi-lô",
  "place.silo_house.description": "Xi-lô có nhà ở kèm bên cạnh.",
  "place.windmill.name": "Cối xay gió",
  "place.windmill.description": "Cối xay gió để xay thóc thành bột.",
  "build.requiresLevel": "Mở ở cấp {level}",
  "build.tier": "Bậc {tier}",
  "build.preview": "Xem trước",
  "build.category.road": "Đường",
  "build.category.vegetation": "Cây trồng",
  "build.category.decoration": "Trang trí",
  "build.category.fence": "Hàng rào",
  "build.category.lighting": "Chiếu sáng",
  "build.category.utility": "Tiện ích",
  "build.category.waterfront": "Bờ nước",
  "build.category.building": "Công trình",
  "build.category.monument": "Tượng đài",
  "market.buy": "Mua",
  "market.sell": "Bán",
  "market.line": "{item} · {price}",
  "field.load": "Tạo hoặc tải nông trại để xem đất đã mở.",
  "field.none": "Nông trại chưa có ô đất nào.",
  "field.empty": "trống",
  "field.ready": "chín",
  "field.stage": "{percent}% · giai đoạn {stage}",
  "field.tile": "{x},{y}",
  "selection.none.title": "Chọn một ô đất",
  "selection.none.detail": "Chọn ô để trồng hoặc thu hoạch.",
  "selection.missing.title": "Ô đã chọn {at} chưa được mở khoá",
  "selection.missing.detail": "Hãy chọn ô đất đã mở khoá.",
  "cell.land.title": "Ô đã chọn: {land}",
  "cell.actions.detail": "Có thể: {actions}",
  "cell.land.farmland": "đất canh tác",
  "cell.land.agriculture": "đất nông nghiệp",
  "cell.land.forestry": "rừng sản xuất",
  "cell.land.mining": "khu dự trữ khai thác",
  "cell.land.civic": "khu dân cư",
  "cell.land.wild": "đất hoang",
  "cell.land.water": "mặt nước",
  "cell.land.aquaculture": "vùng nuôi thuỷ sản",
  "cell.land.shore": "bờ",
  "cell.land.road": "đường",
  "cell.land.building": "công trình",
  "cell.land.open": "đất trống",
  "cell.action.move": "di chuyển",
  "cell.action.plant": "trồng",
  "cell.action.harvest": "thu hoạch",
  "cell.action.uproot": "dỡ bỏ",
  "cell.action.timber": "khai thác gỗ",
  "cell.action.mine": "khai thác đá",
  "cell.action.aquaculture": "nuôi cá",
  "selection.empty.title": "Ô đã chọn {at} · {terrain} · trống",
  "selection.empty.detail": "Chọn cây trồng rồi trồng ở đây.",
  "selection.empty.locked": "Cây này cần người chơi đạt cấp {level}.",
  "selection.empty.noSeed": "Bạn không còn {seed} để trồng. Hãy mua thêm ở Chợ nông sản.",
  "selection.empty.terrain": "Loại đất này không thể trồng.",
  "selection.growing.title": "Ô đã chọn {at} · {crop} · đang lớn",
  "selection.growing.detail": "Đang lớn · {percent}% · {time}",
  "selection.mature.title": "Ô đã chọn {at} · {crop} · đã chín",
  "selection.mature.detail": "Thu hoạch để nhận nông sản và XP.",
  "terrain.GRASS": "cỏ",
  "terrain.SOIL": "đất trồng",
  "terrain.WATER": "nước",
  "terrain.BLOCKED": "bị chặn",
  "terrain.unknown": "không rõ",
  "time.seconds": "còn {count} giây",
  "time.minutes": "còn {count} phút",
  "time.minutesSeconds": "còn {minutes} phút {seconds} giây",
  "time.hours": "còn {count} giờ",
  "time.hoursMinutes": "còn {hours} giờ {minutes} phút",
  "time.days": "còn {count} ngày",
  "time.daysHours": "còn {days} ngày {hours} giờ",
  "time.readySoon": "sắp chín",
  "time.unknown": "chưa rõ thời gian",
  "scene.prepare": "Đang chuẩn bị thế giới 3D…",
  "scene.idle": "Đã tắt chế độ 3D.",
  "scene.unavailable": "Không khả dụng.",
  "scene.active": "3D đang chạy ({tiles} ô đất, {crops} cây).",
  "scene.error": "Lỗi hiển thị 3D: {message}",
  "scene.ready": "Chế độ 3D sẵn sàng. Đi bằng W, A, S, D hoặc các phím mũi tên, kéo để di chuyển camera, và dùng con lăn để thu phóng.",
  "scene.noWebgl": "Trình duyệt này không có WebGL nên không thể mở chế độ 3D.",
  "scene.assetProblem": "Không tải được mô hình {asset}, đang dùng hình tạm: {message}",
  "status.refreshed": "Đã tải lại từ máy chủ.",
  "status.loaded": "Đã tải nông trại. Chọn một ô đất để bắt đầu.",
  "status.created": "Đã tạo nông trại. Chọn một ô đất để bắt đầu.",
  "status.createdDetail": "Đã tạo {name} với {tiles} ô đất đã mở.",
  "status.selectTile": "Hãy chọn một ô đất trước.",
  "status.noCrop": "Chưa có cây trồng nào để trồng.",
  "status.occupied": "Ô đất này đã có cây.",
  "status.planted": "Đã trồng {crop} tại ({x}, {y}).",
  "status.harvested": "Đã thu hoạch {quantity} × {item} · +{xp} XP",
  "status.levelUp": " · đạt cấp {level}",
  "status.bought": "Đã mua {quantity} hết {amount} {currency} → {balance} {currency}.",
  "status.sold": "Đã bán {quantity} được {amount} {currency} → {balance} {currency}.",
  "status.expanded": "Đã mở ô {index} với {tiles} ô đất, tốn {amount} {currency}.",
  "status.uprooted": "Đã nhổ cây tại ({x}, {y}).",
  "status.loadFarm": "Hãy tải nông trại trước.",
  "status.selectMature": "Hãy chọn cây đã chín để thu hoạch.",
  "status.quantity": "Số lượng phải là số nguyên dương.",
  "status.going": "Đang đi tới{at}.",
  "error.INSUFFICIENT_FUNDS": "Không đủ vàng cho giao dịch này.",
  "error.INSUFFICIENT_ITEMS": "Bạn không có đủ vật phẩm đó.",
  "error.CROP_NOT_MATURE": "Cây này vẫn đang lớn.",
  "error.CROP_ALREADY_HARVESTED": "Cây này đã được thu hoạch rồi.",
  "error.CROP_NOT_FOUND": "Cây này không còn ở đó.",
  "error.CROP_LEVEL_REQUIRED": "Cây này cần cấp người chơi cao hơn.",
  "error.PLOT_LEVEL_REQUIRED": "Ô đất tiếp theo cần cấp người chơi cao hơn.",
  "error.PLOT_LIMIT_REACHED": "Toàn bộ ô đất hiện có đã được mở khoá.",
  "error.TILE_OCCUPIED": "Ô đất này đã được trồng.",
  "error.TILE_NOT_PLANTABLE": "Ô đất này không thể trồng.",
  "error.CONFLICT_STALE_STATE": "Trạng thái máy chủ đã thay đổi; hãy tải lại rồi thử lại.",
  "error.IDEMPOTENCY_CONFLICT": "Mã yêu cầu này đã dùng cho một hành động khác.",
  "error.REQUEST_ALREADY_PROCESSED": "Yêu cầu này đã được xử lý.",
  "error.INVENTORY_LIMIT_EXCEEDED": "Túi đồ đã đầy.",
  "error.SHOP_ENTRY_NOT_ALLOWED": "Chợ không giao dịch vật phẩm này theo cách đó.",
  "error.NOT_AUTHENTICATED": "Chưa xác thực: kiểm tra mã phát triển.",
  "error.NOT_AUTHORIZED": "Bạn không có quyền với nông trại này.",
  "error.RESOURCE_NOT_FOUND": "Máy chủ không tìm thấy.",
  "error.INTERNAL_ERROR": "Lỗi máy chủ.",
  "error.INVALID_INPUT": "Yêu cầu bị từ chối vì không hợp lệ."
  ,
  "dock.tree": "Cây ăn quả",
  "dock.plantTree": "Trồng cây ăn quả",
  "dock.removeTree": "Nhổ bỏ cây",
  "dock.removeTree.confirm": "Nhổ bỏ cây này? Cây giống sẽ không được hoàn lại.",
  "dock.saplingCount": "{count} cây giống",
  "dock.noSapling": "Bạn không còn {sapling} để trồng. Hãy mua thêm ở Chợ nông sản.",
  "plant.crops": "Cây trồng",
  "plant.trees": "Cây ăn quả",
  "tree.state.GROWING": "đang lớn",
  "tree.state.READY": "có quả",
  "tree.state.REGROWING": "đang hồi phục",
  "selection.tree.title": "Đã chọn {at} · {tree} · {state}",
  "selection.tree.growingDetail": "Đang lớn · {percent}% · {time}",
  "selection.tree.readyDetail": "Quả đã chín · thu hoạch để nhận {item} và XP.",
  "selection.tree.regrowingDetail": "Đang hồi phục · {time}",
  "selection.empty.noSapling": "Bạn không còn {sapling} để trồng. Hãy mua thêm ở Chợ nông sản.",
  "selection.empty.treeLocked": "Cây này cần cấp người chơi {level}.",
  "status.plantedTree": "Đã trồng {tree} tại ({x}, {y}).",
  "status.removedTree": "Đã nhổ bỏ cây tại ({x}, {y}).",
  "status.selectReadyTree": "Hãy chọn cây đã có quả để thu hoạch.",
  "error.TREE_NOT_READY": "Cây này chưa có quả.",
  "error.TREE_NOT_FOUND": "Cây này không còn ở đó.",
  "error.TREE_DEFINITION_NOT_FOUND": "Bản dựng này không có loại cây đó.",
  "error.TREE_LEVEL_REQUIRED": "Cây này cần cấp người chơi cao hơn."
};

const MESSAGES: Record<Language, Record<MessageKey, string>> = {
  en: EN_MESSAGES,
  vi: VI_MESSAGES
};

export function createTranslator(language: Language): Translate {
  const catalog = MESSAGES[language];
  return (key, params) => interpolate(catalog[key], params);
}

/**
 * Game-data display names, keyed by the key the server sends.
 *
 * A dictionary rather than a list of crops: a key the client has never seen falls back to the stable
 * identifier the caller already has, so a definition added to game data still appears -- with its
 * raw id -- instead of breaking the row or disappearing.
 */
const DISPLAY_NAMES: Record<Language, Record<string, string>> = {
  en: {
    "crop.carrot.name": "Carrot",
    "tree.apple.name": "Apple Tree",
    "item.apple_sapling.name": "Apple sapling",
    "item.apple.name": "Apple",
    "crop.wheat.name": "Wheat",
    "crop.corn.name": "Corn",
    "item.carrot.name": "Carrot",
    "item.wheat.name": "Wheat",
    "item.corn.name": "Corn",
    "item.carrot_seed.name": "Carrot seeds",
    "item.wheat_seed.name": "Wheat seeds",
    "item.corn_seed.name": "Corn seeds",
    "currency.gold.name": "Gold"
  },
  vi: {
    "tree.apple.name": "Cây táo",
    "item.apple_sapling.name": "Cây táo giống",
    "item.apple.name": "Táo",
    "crop.carrot.name": "Cà rốt",
    "crop.wheat.name": "Lúa mì",
    "crop.corn.name": "Ngô",
    "item.carrot.name": "Cà rốt",
    "item.wheat.name": "Lúa mì",
    "item.corn.name": "Ngô",
    "item.carrot_seed.name": "Hạt cà rốt",
    "item.wheat_seed.name": "Hạt lúa mì",
    "item.corn_seed.name": "Hạt ngô",
    "currency.gold.name": "Vàng"
  }
};

/**
 * A translated game-data name, or the caller's fallback when the key is unknown to this client.
 *
 * The shop's catalogue rows and their descriptions are message keys rather than entries in the display
 * dictionary above, because they are UI text like every other label; this reads both tables so a
 * caller never has to know which one a key happens to live in.
 */
export function displayName(language: Language, displayNameKey: string, fallback: string): string {
  // Read as a partial map: the message catalogue is typed for the keys *this* client ships, and the
  // server is free to send a key it has never heard of.
  const messages: Partial<Record<string, string>> = MESSAGES[language];
  return DISPLAY_NAMES[language][displayNameKey] ?? messages[displayNameKey] ?? fallback;
}

/** Currency names read lowercase inside a sentence in English but keep their form in Vietnamese. */
export function currencyName(language: Language, displayNameKey: string, fallback: string): string {
  const name = displayName(language, displayNameKey, fallback);
  return language === "en" ? name.toLowerCase() : name;
}

/**
 * A stable error code, translated.
 *
 * An unknown code is shown as itself: an unrecognised failure is still information, and inventing a
 * friendly sentence for it would hide which server rule refused the command.
 */
export function errorMessage(t: Translate, code: string): string {
  const key = ERROR_MESSAGE_KEYS[code];
  return key === undefined ? code : t(key);
}

const ERROR_MESSAGE_KEYS: Record<string, MessageKey> = {
  INSUFFICIENT_FUNDS: "error.INSUFFICIENT_FUNDS",
  INSUFFICIENT_ITEMS: "error.INSUFFICIENT_ITEMS",
  CROP_NOT_MATURE: "error.CROP_NOT_MATURE",
  CROP_ALREADY_HARVESTED: "error.CROP_ALREADY_HARVESTED",
  CROP_NOT_FOUND: "error.CROP_NOT_FOUND",
  CROP_LEVEL_REQUIRED: "error.CROP_LEVEL_REQUIRED",
  PLOT_LEVEL_REQUIRED: "error.PLOT_LEVEL_REQUIRED",
  PLOT_LIMIT_REACHED: "error.PLOT_LIMIT_REACHED",
  TILE_OCCUPIED: "error.TILE_OCCUPIED",
  TILE_NOT_PLANTABLE: "error.TILE_NOT_PLANTABLE",
  CONFLICT_STALE_STATE: "error.CONFLICT_STALE_STATE",
  IDEMPOTENCY_CONFLICT: "error.IDEMPOTENCY_CONFLICT",
  REQUEST_ALREADY_PROCESSED: "error.REQUEST_ALREADY_PROCESSED",
  INVENTORY_LIMIT_EXCEEDED: "error.INVENTORY_LIMIT_EXCEEDED",
  SHOP_ENTRY_NOT_ALLOWED: "error.SHOP_ENTRY_NOT_ALLOWED",
  NOT_AUTHENTICATED: "error.NOT_AUTHENTICATED",
  NOT_AUTHORIZED: "error.NOT_AUTHORIZED",
  RESOURCE_NOT_FOUND: "error.RESOURCE_NOT_FOUND",
  INTERNAL_ERROR: "error.INTERNAL_ERROR",
  INVALID_INPUT: "error.INVALID_INPUT"
  ,
  TREE_NOT_READY: "error.TREE_NOT_READY",
  TREE_NOT_FOUND: "error.TREE_NOT_FOUND",
  TREE_DEFINITION_NOT_FOUND: "error.TREE_DEFINITION_NOT_FOUND",
  TREE_LEVEL_REQUIRED: "error.TREE_LEVEL_REQUIRED"
};

export function terrainName(language: Language, terrainType: string): string {
  const t = createTranslator(language);
  const key = `terrain.${terrainType}` as MessageKey;
  return terrainType in TERRAIN_KEYS ? t(key) : t("terrain.unknown");
}

const TERRAIN_KEYS: Record<string, true> = {
  GRASS: true,
  SOIL: true,
  WATER: true,
  BLOCKED: true
};
