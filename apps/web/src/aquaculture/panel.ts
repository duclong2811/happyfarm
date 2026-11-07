import type { AquaculturePondDTO } from "@happy-farm/contracts";
import type { ConstructionDTO } from "@happy-farm/contracts";

export type AquaculturePanelState =
  | {
      readonly kind: "EMPTY" | "GROWING" | "READY";
      readonly fingerlings: number;
      readonly capacity: number;
      readonly availableCapacity: number;
      readonly growingCount: number;
      readonly readyCount: number;
      readonly stockedCount: number;
      readonly action: "STOCK" | "WITHDRAW" | "HARVEST" | "NONE";
      readonly readyAt: string | null;
      readonly cohorts: readonly AquaculturePondDTO["cohorts"][number][];
      readonly stockingLimit: number;
      readonly harvestLimit: number;
      readonly withdrawLimit: number;
      readonly isFull: boolean;
    };

export type AquacultureLanguage = "en" | "vi";

/** The server allocates both settlement commands FIFO by readyAt, with cohortId as a stable tie-breaker. */
export function sortAquacultureCohorts(pond: Pick<AquaculturePondDTO, "cohorts">): readonly AquaculturePondDTO["cohorts"][number][] {
  return [...pond.cohorts].sort(
    (left, right) => Date.parse(left.readyAt) - Date.parse(right.readyAt) || left.cohortId.localeCompare(right.cohortId)
  );
}

export function aquacultureRemainingSeconds(readyAt: string, nowMs = Date.now()): number {
  return Math.max(0, Math.floor((Date.parse(readyAt) - nowMs) / 1000));
}

export function formatAquacultureTimestamp(value: string, language: AquacultureLanguage): string {
  return new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-US", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

/** Stable catalogue identity used by the server construction row for an aquaculture cage. */
export function isAquacultureConstruction(construction: Pick<ConstructionDTO, "entryId">): boolean {
  return construction.entryId === "place_fish_cage";
}

/** Presentation-only state for the selected cage; commands remain in the existing API handlers. */
export function aquaculturePanelState(pond: AquaculturePondDTO, fingerlings: number): AquaculturePanelState {
  const action = pond.readyCount > 0 ? "HARVEST" : pond.growingCount > 0 ? "WITHDRAW" : pond.availableCapacity > 0 ? "STOCK" : "NONE";
  return {
    kind: pond.status === "EMPTY" ? "EMPTY" : pond.status === "READY" ? "READY" : "GROWING",
    fingerlings,
    capacity: pond.capacity,
    availableCapacity: pond.availableCapacity,
    growingCount: pond.growingCount,
    readyCount: pond.readyCount,
    stockedCount: pond.stockedCount,
    action,
    readyAt: pond.readyAt,
    cohorts: sortAquacultureCohorts(pond),
    stockingLimit: Math.min(fingerlings, pond.availableCapacity),
    harvestLimit: pond.readyCount,
    withdrawLimit: pond.growingCount,
    isFull: pond.availableCapacity === 0
  };
}
