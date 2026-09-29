import { describe, expect, it } from "vitest";
import {
  createTranslator,
  currencyName,
  detectLanguage,
  displayName,
  errorMessage,
  interpolate,
  isLanguage,
  languageTag,
  LANGUAGE_STORAGE_KEY,
  otherLanguage,
  readStoredLanguage,
  storeLanguage,
  terrainName,
  type MessageKey,
  type LanguageStorage
} from "../../apps/web/src/i18n";

class MemoryStorage implements LanguageStorage {
  private readonly values = new Map<string, string>();
  constructor(initial?: string) {
    if (initial !== undefined) this.values.set(LANGUAGE_STORAGE_KEY, initial);
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class BlockedStorage implements LanguageStorage {
  getItem(): string | null {
    throw new Error("blocked");
  }
  setItem(): void {
    throw new Error("blocked");
  }
}

const en = createTranslator("en");
const vi = createTranslator("vi");

describe("language detection and persistence", () => {
  it("uses the saved choice when there is one", () => {
    expect(detectLanguage("vi", "en-US")).toBe("vi");
    expect(detectLanguage("en", "vi-VN")).toBe("en");
  });

  it("falls back to the browser language, and treats anything else as English", () => {
    expect(detectLanguage(null, "vi")).toBe("vi");
    expect(detectLanguage(null, "vi-VN")).toBe("vi");
    expect(detectLanguage(null, "VI-vn")).toBe("vi");
    expect(detectLanguage(null, "en-GB")).toBe("en");
    expect(detectLanguage(null, "fr-FR")).toBe("en");
    expect(detectLanguage(null, null)).toBe("en");
    expect(detectLanguage("de", "vi")).toBe("vi");
  });

  it("ignores a saved value that is not a language this client speaks", () => {
    expect(readStoredLanguage(new MemoryStorage("klingon"))).toBeNull();
    expect(readStoredLanguage(new MemoryStorage("vi"))).toBe("vi");
    expect(readStoredLanguage(new MemoryStorage())).toBeNull();
    expect(isLanguage("vi")).toBe(true);
    expect(isLanguage("fr")).toBe(false);
    expect(isLanguage(null)).toBe(false);
  });

  it("remembers the player's choice", () => {
    const storage = new MemoryStorage();
    storeLanguage(storage, "vi");
    expect(readStoredLanguage(storage)).toBe("vi");
    storeLanguage(storage, "en");
    expect(readStoredLanguage(storage)).toBe("en");
  });

  it("still runs when the browser refuses storage", () => {
    // A private-mode or full localStorage must not stop the game from loading: the choice simply is
    // not persisted, and detection falls back to the browser language.
    expect(readStoredLanguage(new BlockedStorage())).toBeNull();
    expect(() => { storeLanguage(new BlockedStorage(), "vi"); }).not.toThrow();
  });

  it("names the other language and the html lang tag", () => {
    expect(otherLanguage("en")).toBe("vi");
    expect(otherLanguage("vi")).toBe("en");
    expect(languageTag("vi")).toBe("vi");
    expect(languageTag("en")).toBe("en");
  });
});

describe("game-data display names", () => {
  it("translates the crop and item keys the server sends, in both languages", () => {
    expect(displayName("en", "crop.carrot.name", "crop_carrot")).toBe("Carrot");
    expect(displayName("vi", "crop.carrot.name", "crop_carrot")).toBe("Cà rốt");
    expect(displayName("en", "item.carrot_seed.name", "item_carrot_seed")).toBe("Carrot seeds");
    expect(displayName("vi", "item.carrot_seed.name", "item_carrot_seed")).toBe("Hạt cà rốt");
    expect(displayName("vi", "item.corn.name", "item_corn")).toBe("Ngô");
  });

  it("falls back to the stable id for a key this client has never seen", () => {
    // A crop added to game data still renders: it is untranslated, not missing, and never turned
    // into an empty row.
    expect(displayName("en", "crop.pumpkin.name", "crop_pumpkin")).toBe("crop_pumpkin");
    expect(displayName("vi", "item.pumpkin_seed.name", "item_pumpkin_seed")).toBe("item_pumpkin_seed");
  });

  it("lowercases a currency inside an English sentence but not a Vietnamese one", () => {
    expect(currencyName("en", "currency.gold.name", "currency_gold")).toBe("gold");
    expect(currencyName("vi", "currency.gold.name", "currency_gold")).toBe("Vàng");
    expect(currencyName("en", "currency.gem.name", "currency_gem")).toBe("currency_gem");
  });

  it("names terrain in the current language, with a fallback for an unknown type", () => {
    expect(terrainName("en", "SOIL")).toBe("soil");
    expect(terrainName("vi", "SOIL")).toBe("đất trồng");
    expect(terrainName("en", "LAVA")).toBe("unknown");
    expect(terrainName("vi", "LAVA")).toBe("không rõ");
  });
});

describe("HUD wording", () => {
  it("interpolates placeholders and leaves unknown ones visible", () => {
    expect(interpolate("Hi {name}, {count} left", { name: "Ada", count: 3 })).toBe("Hi Ada, 3 left");
    expect(interpolate("{missing}")).toBe("{missing}");
  });

  it("names every action the dock can offer, in both languages", () => {
    expect([en("dock.plant"), en("dock.harvest"), en("dock.uproot")]).toEqual(["Plant crop", "Harvest", "Uproot"]);
    expect([vi("dock.plant"), vi("dock.harvest"), vi("dock.uproot")]).toEqual(["Trồng cây", "Thu hoạch", "Nhổ cây"]);
  });

  it("confirms an uproot in the language the player is reading", () => {
    expect(en("dock.uproot.confirm")).toBe("Uproot this crop? The seed will not be refunded.");
    expect(vi("dock.uproot.confirm")).toBe("Nhổ cây này? Hạt giống sẽ không được hoàn lại.");
  });

  it("phrases the seed count and the empty-tile states in both languages", () => {
    expect(en("dock.seedCount", { count: 12 })).toBe("12 seeds");
    expect(vi("dock.seedCount", { count: 12 })).toBe("12 hạt");
    for (const key of ["selection.none.title", "selection.empty.title", "selection.growing.title", "selection.mature.title"] as const) {
      const english = en(key, { at: " (0, 0)", terrain: "soil", crop: "Carrot" });
      const vietnamese = vi(key, { at: " (0, 0)", terrain: "đất trồng", crop: "Cà rốt" });
      expect(english).not.toBe("");
      expect(vietnamese).not.toBe("");
      // Nothing is left as a raw key in either language.
      expect(english).not.toContain(key);
      expect(vietnamese).not.toContain(key);
    }
    expect(en("selection.empty.noSeed", { seed: "Carrot seeds" })).toContain("Carrot seeds");
    expect(vi("selection.empty.noSeed", { seed: "Hạt cà rốt" })).toContain("Hạt cà rốt");
  });

  it("translates a stable error code, and shows an unknown one as itself", () => {
    expect(errorMessage(en, "INSUFFICIENT_ITEMS")).toBe("You do not have enough of that item.");
    expect(errorMessage(vi, "INSUFFICIENT_ITEMS")).toBe("Bạn không có đủ vật phẩm đó.");
    expect(errorMessage(vi, "SHOP_ENTRY_NOT_ALLOWED")).toBe("Chợ không giao dịch vật phẩm này theo cách đó.");
    expect(errorMessage(en, "SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });

  it("has real text for every user-visible key the page uses, in both languages", () => {
    // The type system already requires a translation; this is the runtime witness that the text is
    // actually there, so a missing or empty entry cannot silently ship as a blank HUD.
    const keys: readonly MessageKey[] = [
      "language.label",
      "language.switch",
      "hud.gold",
      "hud.refresh",
      "hud.starting",
      "panel.inventory",
      "panel.land",
      "panel.market",
      "panel.bag",
      "panel.collapse",
      "panel.expand",
      "panel.close",
      "hud.modules",
      "market.tab",
      "market.collapse",
      "market.expand",
      "market.quantity",
      "market.decrease",
      "market.increase",
      "market.noBuy",
      "market.noSell",
      "dock.crop",
      "dock.plant",
      "dock.harvest",
      "dock.uproot",
      "dock.go",
      "dock.goTitle",
      "dock.uproot.confirm",
      "dock.seedCount",
      "land.unlock",
      "land.next",
      "land.all",
      "progression.signedOut",
      "progression.level",
      "progression.toNext",
      "progression.cap",
      "inventory.empty",
      "inventory.line",
      "market.signedOut",
      "market.buy",
      "market.sell",
      "market.line",
      "field.load",
      "field.none",
      "field.empty",
      "field.ready",
      "field.stage",
      "selection.none.title",
      "selection.none.detail",
      "selection.missing.title",
      "selection.missing.detail",
      "selection.empty.detail",
      "selection.empty.locked",
      "selection.empty.noSeed",
      "selection.empty.terrain",
      "selection.growing.detail",
      "selection.mature.detail",
      "time.seconds",
      "time.minutes",
      "time.minutesSeconds",
      "time.hours",
      "time.hoursMinutes",
      "time.days",
      "time.daysHours",
      "time.readySoon",
      "time.unknown",
      "scene.prepare",
      "scene.idle",
      "scene.unavailable",
      "scene.active",
      "scene.error",
      "scene.ready",
      "scene.noWebgl",
      "scene.assetProblem",
      "status.refreshed",
      "status.loaded",
      "status.created",
      "status.createdDetail",
      "status.selectTile",
      "status.noCrop",
      "status.occupied",
      "status.planted",
      "status.harvested",
      "status.levelUp",
      "status.bought",
      "status.sold",
      "status.expanded",
      "status.uprooted",
      "status.loadFarm",
      "status.selectMature",
      "status.quantity",
      "status.going"
    ];
    expect(keys.length).toBeGreaterThan(50);
    for (const language of ["en", "vi"] as const) {
      const t = createTranslator(language);
      for (const key of keys) {
        const text = t(key);
        expect(text.length, `${language}:${key}`).toBeGreaterThan(0);
        // A template with placeholders is fine; an empty or key-shaped value is not.
        expect(text, `${language}:${key}`).not.toBe(key);
      }
    }
  });
});
