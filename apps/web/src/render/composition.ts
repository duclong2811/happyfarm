import { GROUND_SURFACE_Y, terrainHeightAt, type TerrainShape } from "./terrain-height";
import { tileToWorld, worldFrame, type FarmLayout, type TileCoordinate } from "./layout";
import type { DistrictKind } from "./world-config";

/**
 * Set dressing, as data.
 *
 * One building on grass reads as a prototype; the same building with a yard, a wagon, a stack of
 * crates and a fence reads as a place where work happens. The difference is not the building - it is
 * the forty small decisions around it. This module is where those decisions are written down.
 *
 * Three rules, and they are the whole design:
 *
 * 1. **A composition is authored, not generated.** Every prop has a hand-written offset in the
 *    preset's own frame. Nothing is scattered, nothing is rolled at runtime, and the same preset is
 *    the same yard on every client and after every refresh.
 * 2. **The preset owns intent, the renderer owns nothing.** A preset says "this district, this
 *    anchor, these props, this clearance"; the world model turns it into world metres and the
 *    renderer draws it. No module holds an unrelated coordinate of its own.
 * 3. **A composition is decoration.** It places no tile, blocks no rule, produces nothing, and is
 *    never consulted by collision beyond the circle the preset declares as its own clearing.
 */

/** One prop inside a preset, in the preset's own frame. */
export interface CompositionProp {
  /** A `PROP_MODELS` id. The world definition names an id, never a file. */
  readonly assetId: string;
  /** Offset from the anchor, in tiles, along the preset's own axes. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Rotation about Y relative to the preset's own facing, in radians. */
  readonly rotationY: number;
  /** Multiplier on the model's natural size, for a family of the same prop at different scales. */
  readonly scale: number;
}

/**
 * A place on the island, with the objects that make it read as that place.
 *
 * `clearanceTiles` is how much ground the composition keeps clear of scenery: a yard is not a yard if
 * a thicket grows through the middle of it, and the rule is written here rather than guessed at by
 * the scenery pass.
 */
export interface EnvironmentCompositionPreset {
  readonly id: string;
  readonly district: DistrictKind;
  readonly anchor: TileCoordinate;
  /** Which way the place faces: +z of the preset's own frame. */
  readonly rotationY: number;
  readonly clearanceTiles: number;
  readonly props: readonly CompositionProp[];
}

/** One prop in world metres, ready for the renderer. */
export interface PlacedCompositionProp {
  readonly presetId: string;
  readonly assetId: string;
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
  readonly rotationY: number;
  readonly sizeWorld: number;
}

/** A preset's cleared ground, in world metres, for the scenery pass to avoid. */
export interface CompositionClearing {
  readonly id: string;
  readonly worldX: number;
  readonly worldZ: number;
  readonly radiusWorld: number;
}

export interface CompositionWorld {
  readonly props: readonly PlacedCompositionProp[];
  readonly clearings: readonly CompositionClearing[];
}

/**
 * Turns the authored presets into world placements.
 *
 * Pure arithmetic over the world config: no clock, no randomness, no state. A prop's height comes
 * from the same `terrainHeightAt` the ground mesh, the roads, and the player's collision use, so a
 * barrel in a yard on a slope stands on the slope rather than hovering over it or sinking into it.
 */
export function buildCompositions(
  presets: readonly EnvironmentCompositionPreset[],
  layout: FarmLayout,
  terrain: TerrainShape,
  sizeOf: (assetId: string) => number
): CompositionWorld {
  const frame = worldFrame(layout.pitch);
  const props: PlacedCompositionProp[] = [];
  const clearings: CompositionClearing[] = [];

  for (const preset of presets) {
    const anchor = tileToWorld(preset.anchor, frame);
    clearings.push({
      id: preset.id,
      worldX: anchor.worldX,
      worldZ: anchor.worldZ,
      radiusWorld: preset.clearanceTiles * layout.pitch
    });

    const cos = Math.cos(preset.rotationY);
    const sin = Math.sin(preset.rotationY);
    for (const prop of preset.props) {
      const localX = prop.offsetX * layout.pitch;
      const localY = prop.offsetY * layout.pitch;
      // Local +x is the preset's right, local +z its facing; the same rotation the renderer applies to
      // the group, so an authored offset never has to be re-derived by hand.
      const worldX = anchor.worldX + localX * cos + localY * sin;
      const worldZ = anchor.worldZ - localX * sin + localY * cos;
      props.push({
        presetId: preset.id,
        assetId: prop.assetId,
        worldX,
        worldY: GROUND_SURFACE_Y + terrainHeightAt(worldX, worldZ, terrain),
        worldZ,
        rotationY: preset.rotationY + prop.rotationY,
        sizeWorld: sizeOf(prop.assetId) * prop.scale
      });
    }
  }

  return { props, clearings };
}
