import { z } from "zod";
import { currencyRegistry } from "../economy";
import { playerProgression } from "../progression";

/**
 * The deepest plot index this catalogue will accept.
 *
 * A sanity bound, not a layout bound: the plot geometry in `packages/domain` can address far deeper
 * farms, and this is where the product says "no further than this". It mirrors `MAX_PLOT_INDEX` in
 * `@happy-farm/contracts` so the API cannot be handed a plot it would reject; a contract test pins
 * the two together.
 */
export const MAX_PLOT_INDEX = 256;

/**
 * One purchasable piece of land.
 *
 * `plotIndex` is the layout slot and `id` is its name; `createPlotRegistry` refuses a pair that
 * disagrees, so the catalogue cannot describe one slot while naming another. `requiredLevel` is
 * bounded by the levelling curve's own ceiling, so game data cannot define land no level could
 * unlock. The layout itself lives in `packages/domain/src/plot.ts`; game data only decides how far
 * a farm may grow, in what order, and at what price.
 */
export const PlotDefinitionSchema = z
  .object({
    id: z.string().regex(/^plot_[1-9][0-9]*$/),
    plotIndex: z.number().int().min(1).max(MAX_PLOT_INDEX),
    displayNameKey: z.string().regex(/^plot\.[a-z0-9_]+\.name$/),
    currencyDefinitionId: z.string().regex(/^currency_[a-z0-9]+(?:_[a-z0-9]+)*$/),
    price: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    requiredLevel: z.number().int().positive().max(playerProgression.maxLevel)
  })
  .strict();

export type PlotDefinitionData = z.infer<typeof PlotDefinitionSchema>;

/**
 * Validates the catalogue and refuses a gap in it.
 *
 * Plots must be exactly `plot_1` through `plot_N` in order. A missing index would be land the farm
 * can never buy while everything behind it stays unreachable, so the gap is rejected at load rather
 * than turned into a dead end at runtime.
 */
export function createPlotRegistry(input: unknown): ReadonlyMap<string, PlotDefinitionData> {
  const definitions = z.array(PlotDefinitionSchema).parse(input);
  const registry = new Map<string, PlotDefinitionData>();
  let nextIndex = 1;
  for (const definition of definitions) {
    if (registry.has(definition.id)) throw new Error(`Duplicate plot definition: ${definition.id}`);
    if (definition.id !== `plot_${String(definition.plotIndex)}`) {
      throw new Error(`Plot definition ID does not match its index: ${definition.id}`);
    }
    if (definition.plotIndex !== nextIndex) {
      throw new Error(`Plot definitions must be contiguous from plot_1: ${definition.id}`);
    }
    if (!currencyRegistry.has(definition.currencyDefinitionId)) {
      throw new Error(`Unknown plot currency definition: ${definition.currencyDefinitionId}`);
    }
    nextIndex += 1;
    registry.set(definition.id, definition);
  }
  return registry;
}

export const plotRegistry = createPlotRegistry([
  { id: "plot_1", plotIndex: 1, displayNameKey: "plot.1.name", currencyDefinitionId: "currency_gold", price: 100, requiredLevel: 1 },
  { id: "plot_2", plotIndex: 2, displayNameKey: "plot.2.name", currencyDefinitionId: "currency_gold", price: 250, requiredLevel: 2 },
  { id: "plot_3", plotIndex: 3, displayNameKey: "plot.3.name", currencyDefinitionId: "currency_gold", price: 500, requiredLevel: 3 },
  { id: "plot_4", plotIndex: 4, displayNameKey: "plot.4.name", currencyDefinitionId: "currency_gold", price: 1_000, requiredLevel: 4 },
  { id: "plot_5", plotIndex: 5, displayNameKey: "plot.5.name", currencyDefinitionId: "currency_gold", price: 2_000, requiredLevel: 5 },
  { id: "plot_6", plotIndex: 6, displayNameKey: "plot.6.name", currencyDefinitionId: "currency_gold", price: 3_500, requiredLevel: 6 },
  { id: "plot_7", plotIndex: 7, displayNameKey: "plot.7.name", currencyDefinitionId: "currency_gold", price: 5_500, requiredLevel: 7 },
  { id: "plot_8", plotIndex: 8, displayNameKey: "plot.8.name", currencyDefinitionId: "currency_gold", price: 8_000, requiredLevel: 8 }
]);

/**
 * The catalogue entry for a layout slot, or null when the catalogue sells no more land there.
 *
 * The id is derived from the index exactly as `createPlotRegistry` requires it to be, so the lookup
 * and the validation cannot disagree about how a slot is named.
 */
export function plotDefinitionForIndex(index: number): PlotDefinitionData | null {
  if (!Number.isSafeInteger(index) || index < 1 || index > MAX_PLOT_INDEX) return null;
  return plotRegistry.get(`plot_${String(index)}`) ?? null;
}

export const plots = [...plotRegistry.values()];
