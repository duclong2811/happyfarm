import { ROADS, ROAD_NODES, type Road, type RoadNodeId } from "./world-config";

/**
 * The road network as a graph, rather than as a picture.
 *
 * The brief's rule is that nothing the island authors is stranded - and that rule is only worth
 * anything if it can be checked. So the roads declare the stops they make (`Road.connects`) and this
 * module turns that declaration into a graph: nodes are the named places, edges are the consecutive
 * pairs of stops on each road.
 *
 * The V12 direction shrank what "authored" means. The island still builds the harbour-to-village
 * road, the village's own circulation, and the lanes its community works; the orchard, the managed
 * wood, and the lake no longer get roads across them, because the player builds those. The graph is
 * therefore a smaller, stricter claim than it used to be: every stop the roads name must still be
 * reachable, and a place with no road is a place the player has not built to yet rather than one the
 * island forgot.
 *
 * It is deliberately separate from the geometry. A road's *shape* is a spline through waypoints and
 * belongs to `roads.ts`; a road's *meaning* - what it connects - is a claim about the world, and a
 * claim is something a test can hold to account. The two cannot drift into disagreement about which
 * districts are reachable, because only one of them answers that question.
 */

export interface RoadNetwork {
  /** Every place the network names, whether or not a road reaches it. */
  readonly nodes: readonly RoadNodeId[];
  /** The stops each road connects, in order. */
  readonly roads: readonly { readonly id: string; readonly stops: readonly RoadNodeId[] }[];
  /** Adjacency, one entry per node. */
  readonly adjacency: ReadonlyMap<RoadNodeId, readonly RoadNodeId[]>;
}

/** Builds the graph from the roads, with every declared node present even before a road reaches it. */
export function buildRoadNetwork(roads: readonly Road[] = ROADS): RoadNetwork {
  const adjacency = new Map<RoadNodeId, RoadNodeId[]>();
  for (const node of Object.keys(ROAD_NODES) as RoadNodeId[]) adjacency.set(node, []);

  const link = (from: RoadNodeId, to: RoadNodeId): void => {
    const fromList = adjacency.get(from);
    const toList = adjacency.get(to);
    if (fromList === undefined || toList === undefined) return;
    if (!fromList.includes(to)) fromList.push(to);
    if (!toList.includes(from)) toList.push(from);
  };

  for (const road of roads) {
    for (let index = 0; index < road.connects.length - 1; index += 1) {
      const from = road.connects[index];
      const to = road.connects[index + 1];
      if (from === undefined || to === undefined) continue;
      link(from, to);
    }
  }

  return {
    nodes: Object.keys(ROAD_NODES) as RoadNodeId[],
    roads: roads.map((road) => ({ id: road.id, stops: road.connects })),
    adjacency
  };
}

/**
 * Every place reachable from `origin`, following roads in either direction.
 *
 * Breadth-first and total: a district that no route reaches simply does not appear in the result,
 * which is exactly the condition the island is not allowed to be in.
 */
export function reachableFrom(origin: RoadNodeId, network: RoadNetwork = buildRoadNetwork()): ReadonlySet<RoadNodeId> {
  const seen = new Set<RoadNodeId>([origin]);
  const queue: RoadNodeId[] = [origin];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const neighbour of network.adjacency.get(current) ?? []) {
      if (seen.has(neighbour)) continue;
      seen.add(neighbour);
      queue.push(neighbour);
    }
  }
  return seen;
}

/**
 * The places the island says a player must be able to walk to without building anything.
 *
 * Kept as an explicit list rather than derived from the districts: the districts are *landscape* (a
 * blob's identity), and this is *access* (can a person get there). Under the V12 direction the list
 * is the *community*: the quay, the yard behind it, the civic square, the barn's yard, and the
 * high-ground trail that leaves the village for the volcano's foothill. The production districts
 * that used to be on
 * this list are reached by roads a player builds; requiring one would re-author a decision the
 * direction gives back to the player.
 */
export const REQUIRED_ROAD_DESTINATIONS: readonly RoadNodeId[] = [
  "harbour",
  "harbour_yard",
  "civic",
  "plaza",
  "farm_hub",
  "highland"
];
