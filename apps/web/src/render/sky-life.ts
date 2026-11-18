import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Sprite,
  SpriteMaterial,
  type Object3D
} from "three";

/**
 * What makes the sky look alive: a sun standing where the light comes from, and clouds drifting
 * slowly round the island.
 *
 * Presentation only. Nothing here is picked, collides, or carries state. The pieces are cheap: one
 * sprite for the sun, and a dozen clouds sharing one geometry and one material. A cloud moves only
 * when the scene's ambient tick asks it to (`driftClouds`); on the low quality profile there is no
 * tick, and the clouds simply hang still.
 */

/** A soft radial disc: a bright core fading into a warm halo. */
function sunTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context === null) return null;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255, 255, 246, 1)");
  gradient.addColorStop(0.18, "rgba(255, 249, 214, 1)");
  gradient.addColorStop(0.26, "rgba(255, 236, 170, 0.75)");
  gradient.addColorStop(0.55, "rgba(255, 214, 140, 0.18)");
  gradient.addColorStop(1, "rgba(255, 214, 140, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new CanvasTexture(canvas);
}

/**
 * The sun: a glowing disc far out along the light's own direction, so the shadows on the island point
 * away from where it is seen. Excluded from fog - it is beyond the horizon haze.
 */
export function createSun(): Sprite | null {
  const texture = sunTexture();
  if (texture === null) return null;
  const sun = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false, blending: AdditiveBlending }));
  sun.name = "sky-sun";
  sun.scale.setScalar(150);
  sun.renderOrder = -1;
  return sun;
}

/** Puts the sun on the sky dome, `distance` from the island centre along the light's direction. */
export function placeSun(sun: Object3D, centreX: number, centreZ: number, direction: { x: number; y: number; z: number }, distance: number): void {
  const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
  sun.position.set(centreX + (direction.x / length) * distance, (direction.y / length) * distance, centreZ + (direction.z / length) * distance);
}

interface CloudState {
  readonly cloud: Group;
  readonly speed: number;
  angle: number;
  readonly radius: number;
}

/** A small deterministic generator, so a page shows the same sky every time it opens. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * About a dozen low-poly clouds in a wide ring round the island: puffs of one shared geometry, white,
 * flat-shaded, bright enough that the hemisphere light reads them as cloud rather than as stone.
 *
 * The ring starts well beyond the estate camera's farthest reach (125 m from the island), so a cloud
 * is only ever seen against the sky and never drifts between the camera and the island. They are kept
 * out of the fog, which would otherwise dissolve anything that far away into the horizon colour.
 */
export function createClouds(seed = 7): Group {
  const roll = random(seed);
  const geometry = new IcosahedronGeometry(1, 1);
  const material = new MeshStandardMaterial({ color: 0xffffff, emissive: 0xdfe9f2, emissiveIntensity: 0.5, roughness: 1, flatShading: true, fog: false });
  const group = new Group();
  group.name = "sky-clouds";
  const states: CloudState[] = [];
  const count = 13;
  for (let index = 0; index < count; index += 1) {
    const cloud = new Group();
    const puffs = 4 + Math.floor(roll() * 4);
    for (let p = 0; p < puffs; p += 1) {
      const puff = new Mesh(geometry, material);
      const size = 1.4 + roll() * 1.6;
      puff.scale.set(size * 1.35, size * 0.85, size);
      puff.position.set((p - puffs / 2) * 1.7 + (roll() - 0.5) * 0.8, (roll() - 0.3) * 0.9, (roll() - 0.5) * 1.6);
      puff.castShadow = false;
      puff.receiveShadow = false;
      cloud.add(puff);
    }
    const scale = 5 + roll() * 4;
    cloud.scale.setScalar(scale);
    cloud.position.y = 14 + roll() * 30;
    cloud.rotation.y = roll() * Math.PI;
    const state: CloudState = { cloud, speed: 0.004 + roll() * 0.005, angle: (index / count) * Math.PI * 2 + roll() * 0.4, radius: 230 + roll() * 190 };
    states.push(state);
    group.add(cloud);
  }
  group.userData.clouds = states;
  driftClouds(group, 0);
  return group;
}

/** Moves the clouds round the island by `seconds` of wind. */
export function driftClouds(group: Group, seconds: number): void {
  const states = group.userData.clouds as CloudState[] | undefined;
  if (states === undefined) return;
  for (const state of states) {
    state.angle += state.speed * seconds;
    state.cloud.position.x = Math.cos(state.angle) * state.radius;
    state.cloud.position.z = Math.sin(state.angle) * state.radius;
  }
}
