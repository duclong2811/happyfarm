import {
  broadsidePower,
  seaCosine,
  seaSine,
  SEA_BATTLE_AIM_LIMIT,
  SEA_BATTLE_MAX_RANGE,
  SEA_BATTLE_MIN_RANGE,
  SEA_BATTLE_TURN_UNITS,
  type SeaBattleAction,
  type SeaBattleSide,
  type SeaBattleState
} from "@happy-farm/domain";

/** An order as a device gives it: an action, and a broadside's aim off the beam. */
export interface CaptainOrder {
  readonly action: SeaBattleAction;
  readonly aim?: number;
}

/** The time a ball takes to come down `range` away, at the simulation's 30-degree elevation and g = 30. */
function flightSeconds(range: number): number {
  const speed = Math.sqrt((range * 30) / (2 * 0.5 * 0.8660254037844386));
  return (2 * speed * 0.5) / 30;
}

/**
 * A captain that plays like an attentive player: bow on the nearest pirate at full sail until within
 * `closeAt`, then keeps it abeam at half sail; holds the side it is on to charge just enough for the
 * range, aiming where the pirate will be when the ball comes down. It does not allow for the wind.
 * With `rowAt`, it pulls the oars when the pirate is dead ahead and that close: a ram.
 */
export function gunner(options: { readonly closeAt?: number; readonly rowAt?: number } = {}): (state: SeaBattleState) => CaptainOrder[] {
  const closeAt = options.closeAt ?? 60;
  return (state) => {
    const me = state.ships[0];
    const target = state.ships
      .slice(1)
      .filter((ship) => ship.alive)
      .sort((a, b) => (a.x - (me?.x ?? 0)) ** 2 + (a.z - (me?.z ?? 0)) ** 2 - ((b.x - (me?.x ?? 0)) ** 2 + (b.z - (me?.z ?? 0)) ** 2))[0];
    if (me === undefined || target === undefined) return [];
    const dx = target.x - me.x;
    const dz = target.z - me.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    const fx = seaCosine(me.heading);
    const fz = seaSine(me.heading);
    const cross = fx * dz - fz * dx;
    const dot = fx * dx + fz * dz;
    const close = distance < closeAt;
    const abeam = Math.abs(dot) / distance < 0.3;
    const ahead = dot > 0 && Math.abs(cross) / distance < 0.15;
    const rudder: SeaBattleAction = close && options.rowAt === undefined
      ? abeam ? "RUDDER_CENTER" : dot > 0 ? (cross > 0 ? "RUDDER_LEFT" : "RUDDER_RIGHT") : cross > 0 ? "RUDDER_RIGHT" : "RUDDER_LEFT"
      : ahead ? "RUDDER_CENTER" : cross > 0 ? "RUDDER_RIGHT" : "RUDDER_LEFT";
    const orders: CaptainOrder[] = [];
    if (me.rudder !== (rudder === "RUDDER_LEFT" ? -1 : rudder === "RUDDER_RIGHT" ? 1 : 0)) orders.push({ action: rudder });
    const sail = close && options.rowAt === undefined ? 1 : 2;
    if (me.sail !== sail) orders.push({ action: sail === 1 ? "SAIL_HALF" : "SAIL_FULL" });
    if (options.rowAt !== undefined && ahead && distance < options.rowAt && me.oars === 0 && me.oarRest === 0) orders.push({ action: "OARS" });

    // Gunnery: lead the target by the ball's flight, find its bearing off this side's beam, and charge.
    const side: SeaBattleSide = cross > 0 ? "STARBOARD" : "PORT";
    const loaded = side === "PORT" ? me.reloadPort === 0 : me.reloadStarboard === 0;
    if (!loaded || me.spec.cannons <= 0) return orders;
    const flight = flightSeconds(Math.min(SEA_BATTLE_MAX_RANGE, Math.max(SEA_BATTLE_MIN_RANGE, distance)));
    const leadX = dx + seaCosine(target.heading) * target.speed * flight - fx * me.speed * flight;
    const leadZ = dz + seaSine(target.heading) * target.speed * flight - fz * me.speed * flight;
    const lead = Math.sqrt(leadX * leadX + leadZ * leadZ);
    const beam = me.heading + (side === "PORT" ? -SEA_BATTLE_TURN_UNITS / 4 : SEA_BATTLE_TURN_UNITS / 4);
    const bx = seaCosine(beam);
    const bz = seaSine(beam);
    const along = (bx * leadX + bz * leadZ) / lead;
    const off = (bx * leadZ - bz * leadX) / lead;
    const aim = Math.round(Math.asin(Math.max(-1, Math.min(1, off))) * (SEA_BATTLE_TURN_UNITS / (2 * Math.PI)));
    const inArc = along > 0 && Math.abs(aim) <= SEA_BATTLE_AIM_LIMIT && lead <= SEA_BATTLE_MAX_RANGE && lead >= SEA_BATTLE_MIN_RANGE * 0.8;
    const charging = side === "PORT" ? me.chargePort >= 0 : me.chargeStarboard >= 0;
    const want = Math.max(0, Math.min(1, (lead - SEA_BATTLE_MIN_RANGE) / (SEA_BATTLE_MAX_RANGE - SEA_BATTLE_MIN_RANGE)));
    if (!charging) {
      if (inArc) orders.push({ action: side === "PORT" ? "CHARGE_PORT" : "CHARGE_STARBOARD" });
    } else if (broadsidePower(me, side, state.tick) >= want - 1e-9) {
      orders.push({ action: side === "PORT" ? "FIRE_PORT" : "FIRE_STARBOARD", aim: inArc ? aim : 0 });
    }
    return orders;
  };
}
