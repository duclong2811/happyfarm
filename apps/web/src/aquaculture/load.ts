import type { AquaculturePondDTO } from "@happy-farm/contracts";

export type AquacultureLoadState =
  | { readonly kind: "IDLE"; readonly farmId: null }
  | { readonly kind: "LOADING"; readonly farmId: string }
  | { readonly kind: "LOADED"; readonly farmId: string; readonly ponds: readonly AquaculturePondDTO[] }
  | { readonly kind: "ERROR"; readonly farmId: string; readonly error: unknown };

export function createAquaculturePondLoader(
  read: (farmId: string) => Promise<readonly AquaculturePondDTO[]>,
  onState: (state: AquacultureLoadState) => void
): (farmId: string) => Promise<void> {
  let generation = 0;
  return async (farmId: string): Promise<void> => {
    const current = ++generation;
    onState({ kind: "LOADING", farmId });
    try {
      const ponds = await read(farmId);
      if (current === generation) onState({ kind: "LOADED", farmId, ponds });
    } catch (error: unknown) {
      if (current === generation) onState({ kind: "ERROR", farmId, error });
    }
  };
}

export function selectedAquaculturePond(
  state: AquacultureLoadState,
  farmId: string | null,
  constructionId: string
):
  | { readonly kind: "LOADING" }
  | { readonly kind: "ERROR"; readonly error: unknown }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "FOUND"; readonly pond: AquaculturePondDTO } {
  if (farmId === null || state.kind === "IDLE" || state.farmId !== farmId || state.kind === "LOADING") {
    return { kind: "LOADING" };
  }
  if (state.kind === "ERROR") return { kind: "ERROR", error: state.error };
  const pond = state.ponds.find((candidate) => candidate.pondId === constructionId);
  return pond === undefined ? { kind: "NOT_FOUND" } : { kind: "FOUND", pond };
}
