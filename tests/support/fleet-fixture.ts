import type { FleetResponse } from "@happy-farm/contracts";

/**
 * Fleet reads as the server sends them (FleetResponseSchema), for client tests: a sloop of one's own
 * in berth 1 of a one-berth dock unless told otherwise.
 */

export const FIXTURE_PLAYER_UUID = "11111111-1111-4111-8111-111111111111";

type FleetShip = FleetResponse["ship"];
type NextShip = NonNullable<FleetResponse["next"]>;

export function nextShip(overrides: Partial<NextShip> = {}): NextShip {
  return {
    classId: "ship_class_brig",
    role: "WAR",
    rank: 2,
    tier: 3,
    requiredPlayerLevel: 25,
    speedTilesPerMinute: 100,
    hull: 320,
    cannons: 6,
    hold: 50,
    cost: { currencyId: "currency_gold", gold: 3000, materials: [{ itemDefinitionId: "item_wood", quantity: 500 }, { itemDefinitionId: "item_ore", quantity: 300 }] },
    ...overrides
  };
}

export function fleetShip(overrides: Partial<FleetShip> = {}): FleetShip {
  return {
    shipId: `ship_${FIXTURE_PLAYER_UUID}`,
    berth: 1,
    lent: false,
    classId: "ship_class_sloop",
    role: "WAR",
    rank: 1,
    tier: 2,
    hull: 150,
    hullMax: 150,
    speedTilesPerMinute: 70,
    cannons: 2,
    hold: 30,
    away: false,
    upgrade: nextShip(),
    ...overrides
  };
}

/** A fleet read; `ship` overrides apply to the ship in hand and to the same ship in `ships`. */
export function fleetResponse(overrides: Partial<Omit<FleetResponse, "ship">> & { readonly ship?: Partial<FleetShip> } = {}): FleetResponse {
  const { ship: shipOverrides, ...rest } = overrides;
  const ship = fleetShip(shipOverrides);
  return {
    readAt: "2026-11-20T10:00:00.000Z",
    ship,
    next: ship.upgrade,
    ships: [ship],
    builds: [
      nextShip({ classId: "ship_class_rowboat", role: "FISHING", rank: 1, tier: 1, requiredPlayerLevel: 1, speedTilesPerMinute: 40, hull: 60, cannons: 0, hold: 20, cost: { currencyId: "currency_gold", gold: 200, materials: [{ itemDefinitionId: "item_wood", quantity: 40 }] } }),
      nextShip({ classId: "ship_class_coaster", role: "MERCHANT", rank: 1, tier: 2, requiredPlayerLevel: 50, speedTilesPerMinute: 70, hull: 220, cannons: 1, hold: 150 }),
      nextShip({ classId: "ship_class_sloop", role: "WAR", rank: 1, tier: 2, requiredPlayerLevel: 10, speedTilesPerMinute: 70, hull: 150, cannons: 2, hold: 30 })
    ],
    dock: { tier: 1, berths: 1, freeBerths: 0, next: { tier: 2, berths: 2, requiredPlayerLevel: 15, cost: { currencyId: "currency_gold", gold: 1500, materials: [{ itemDefinitionId: "item_wood", quantity: 300 }] } } },
    location: "HOME",
    voyage: null,
    ...rest
  };
}
