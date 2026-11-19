import { describe, expect, it } from "vitest";
import { createSeaBattle, runSeaBattle, SEA_BATTLE_ACTIONS, SEA_BATTLE_AIM_LIMIT, seaBattleResult, stepSeaBattle, type SeaBattleSetup } from "@happy-farm/domain";
import { BattleOrders } from "../../apps/web/src/battle-view";

/**
 * The device's record of a fight (battle-view.ts): only orders that change something are kept, each
 * with the tick it took effect, so the server's replay of the record is the fight the player saw.
 */

const SETUP: SeaBattleSetup = {
  seed: 12345,
  player: { hull: 150, hullMax: 150, cannons: 2, speed: 9, turn: 14, radius: 4.5, spread: 40 },
  pirates: [{ hull: 80, hullMax: 80, cannons: 2, speed: 8, turn: 12, radius: 4, spread: 90 }]
};

describe("the battle's orders", () => {
  it("keep only orders that change something, and broadsides only when the guns are loaded", () => {
    const state = createSeaBattle(SETUP);
    const orders = new BattleOrders();
    orders.give("SAIL_DOWN", state.ships[0]);
    orders.give("RUDDER_CENTER", state.ships[0]);
    orders.give("RUDDER_LEFT", state.ships[0]);
    orders.give("RUDDER_LEFT", state.ships[0]);
    orders.give("CHARGE_PORT", state.ships[0]);
    orders.give("OARS", state.ships[0]);
    expect(orders.take(0)).toEqual([{ action: "RUDDER_LEFT" }, { action: "CHARGE_PORT" }, { action: "OARS" }]);
    stepSeaBattle(state, [{ action: "RUDDER_LEFT" }, { action: "CHARGE_PORT" }, { action: "OARS" }]);
    // Already charging, already rowing: neither is an order again. The broadside carries its aim,
    // held inside the arc.
    orders.give("CHARGE_PORT", state.ships[0]);
    orders.give("OARS", state.ships[0]);
    orders.give("FIRE_PORT", state.ships[0], 9_999);
    expect(orders.take(1)).toEqual([{ action: "FIRE_PORT", aim: SEA_BATTLE_AIM_LIMIT }]);
    stepSeaBattle(state, [{ action: "FIRE_PORT", aim: SEA_BATTLE_AIM_LIMIT }]);
    // The port guns are loading now: neither a charge nor a broadside is an order.
    orders.give("CHARGE_PORT", state.ships[0]);
    orders.give("FIRE_PORT", state.ships[0]);
    expect(orders.take(2)).toEqual([]);
    expect(orders.recorded).toEqual([
      [0, SEA_BATTLE_ACTIONS.indexOf("RUDDER_LEFT")],
      [0, SEA_BATTLE_ACTIONS.indexOf("CHARGE_PORT")],
      [0, SEA_BATTLE_ACTIONS.indexOf("OARS")],
      [1, SEA_BATTLE_ACTIONS.indexOf("FIRE_PORT"), SEA_BATTLE_AIM_LIMIT]
    ]);
  });

  it("are a record the server replays to the fight the device played", () => {
    const state = createSeaBattle(SETUP);
    const orders = new BattleOrders();
    const script: Record<number, [Parameters<BattleOrders["give"]>[0], number?][]> = {
      0: [["SAIL_FULL"], ["RUDDER_RIGHT"]],
      40: [["RUDDER_CENTER"], ["CHARGE_STARBOARD"]],
      62: [["FIRE_STARBOARD", -120], ["SAIL_HALF"]],
      150: [["OARS"]],
      200: [["RUDDER_LEFT"], ["CHARGE_PORT"]],
      215: [["FIRE_PORT", 200]],
      260: [["FIRE_STARBOARD"]]
    };
    while (state.outcome === null) {
      for (const [action, aim] of script[state.tick] ?? []) orders.give(action, state.ships[0], aim);
      stepSeaBattle(state, orders.take(state.tick));
    }
    const replayed = runSeaBattle(
      SETUP,
      orders.recorded.map(([tick, action, aim]) => {
        const name = SEA_BATTLE_ACTIONS[action] ?? "RUDDER_CENTER";
        return aim === undefined ? { tick, action: name } : { tick, action: name, aim };
      })
    );
    expect(replayed).toEqual(seaBattleResult(state));
  });
});
