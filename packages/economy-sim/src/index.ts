/**
 * The Happy Farm economy simulator: a design tool, never a runtime dependency.
 *
 * Nothing in `apps/` or `workers/` may import this package. It reads the canonical game data to build
 * a baseline, applies a documented model of the *future* systems (storage, workers, processing, trade,
 * logistics, military) and reports what the resulting economy does over days and populations. See
 * `docs/economy/ECONOMY_SIMULATION.md`.
 */

export * from "./baseline";
export * from "./elements";
export * from "./metrics";
export * from "./model";
export * from "./report";
export * from "./scenario";
export * from "./simulate";
