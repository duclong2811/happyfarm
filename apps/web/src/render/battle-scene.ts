import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry as LineGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Line,
  LineDashedMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  SphereGeometry,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
  type Object3D
} from "three";
import { SEA_BATTLE_ARENA_RADIUS, SEA_BATTLE_TICK_HZ, type SeaBattleSide, type SeaBattleState } from "@happy-farm/domain";
import { draftShareFor, fitShipModel, SHARED_SHIP_GEOMETRY } from "./ship-models";

/**
 * The sea fight, drawn (docs/design/NAVAL.md, W5c).
 *
 * Presentation only: it draws a `SeaBattleState` the battle view steps, and decides nothing. Ships
 * are placed between the last two simulation ticks (`alpha`) so a 20 Hz fight moves smoothly at the
 * screen's own rate. The camera rides behind the player's ship, and swings out over the other beam
 * while a broadside is being aimed, so the whole reach of the shot is in view.
 *
 * Balls fly the simulation's own arc. Where one comes down the sea throws up a splash (a hit throws
 * up a bigger one), and a ramming blow throws up spray between the two hulls: all of it read from
 * the tick's `impacts` and `rams`, drawn once per tick.
 *
 * Each ship draws with its class's model (`render/ship-models.ts`) once the model library has it; a
 * plain block ship stands in until then, so a slow download never holds the fight up.
 */

const SEA_BLUE = 0x2d86b8;
const SKY = 0xcfe9f7;
const MAX_BALLS = 160;
const MAX_SPLASHES = 48;
/** How long a splash stands, in seconds. */
const SPLASH_SECONDS = 0.7;

/** What the player is aiming, for the camera and the preview: the side and the predicted path. */
export interface BattleAim {
  readonly side: SeaBattleSide;
  readonly path: readonly { readonly x: number; readonly y: number; readonly z: number }[];
  readonly landing: { readonly x: number; readonly z: number };
}

/** Which model each ship draws with (index 0 is the player's), and how to get one. */
export interface BattleShipModels {
  readonly ids: readonly (string | null)[];
  readonly load: (modelId: string) => Promise<Object3D | null>;
}

/** A ship's length on the water: a little longer than the circle a ball must enter to hit it. */
function shipLength(radius: number): number {
  return radius * 2.4;
}

export interface BattleScene {
  /** Draws the fight between `previous` positions and `state`'s, `alpha` of the way (0..1). */
  render(state: SeaBattleState, previous: readonly { readonly x: number; readonly z: number; readonly heading: number }[], alpha: number): void;
  /** The broadside being aimed (null when none): drawn as a dashed arc and a ring where it lands. */
  setAim(aim: BattleAim | null): void;
  resize(): void;
  dispose(): void;
}

function battleShip(length: number, pirate: boolean): Group {
  const ship = new Group();
  const hullMaterial = new MeshLambertMaterial({ color: pirate ? 0x3a2a22 : 0x7a4a26 });
  const hull = new Mesh(new BoxGeometry(length, length * 0.22, length * 0.36), hullMaterial);
  hull.position.y = length * 0.06;
  const bow = new Mesh(new ConeGeometry(length * 0.18, length * 0.3, 4), hullMaterial);
  bow.rotation.z = -Math.PI / 2;
  bow.rotation.x = Math.PI / 4;
  bow.position.set(length * 0.62, length * 0.06, 0);
  const deck = new Mesh(new BoxGeometry(length * 0.9, length * 0.04, length * 0.3), new MeshLambertMaterial({ color: 0xc9a46a }));
  deck.position.y = length * 0.18;
  const sailColour = pirate ? 0x1d1d22 : 0xf4efe2;
  ship.add(hull, bow, deck);
  for (const [at, height] of [[-0.22, 0.95], [0.18, 1.15]] as const) {
    const mast = new Mesh(new CylinderGeometry(length * 0.02, length * 0.025, length * height, 6), new MeshLambertMaterial({ color: 0x4a2f18 }));
    mast.position.set(length * at, length * (0.18 + height / 2), 0);
    const sail = new Mesh(new BoxGeometry(length * 0.04, length * height * 0.55, length * 0.42), new MeshLambertMaterial({ color: sailColour }));
    sail.position.set(length * at + length * 0.03, length * (0.18 + height * 0.55), 0);
    ship.add(mast, sail);
  }
  const flag = new Mesh(new BoxGeometry(length * 0.02, length * 0.12, length * 0.2), new MeshLambertMaterial({ color: pirate ? 0x101010 : 0xc0392b }));
  flag.position.set(length * 0.18, length * 1.4, length * 0.1);
  ship.add(flag);
  return ship;
}

/** Frees what this scene made; a ship model's geometry and materials stay with the model library. */
function disposeOwned(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh) || object.userData[SHARED_SHIP_GEOMETRY] === true) return;
    (object.geometry as BufferGeometry).dispose();
    const material = object.material as Material | Material[];
    if (Array.isArray(material)) for (const entry of material) entry.dispose();
    else material.dispose();
  });
}

export function createBattleScene(canvas: HTMLCanvasElement, state: SeaBattleState, models?: BattleShipModels): BattleScene {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new Scene();
  scene.background = new Color(SKY);
  scene.fog = new Fog(SKY, 160, 520);
  const camera = new PerspectiveCamera(50, 1, 0.5, 1500);
  scene.add(new HemisphereLight(0xdcf0ff, 0x2a5a74, 1.1), new AmbientLight(0xffffff, 0.2));
  const sun = new DirectionalLight(0xfff0cd, 1.6);
  sun.position.set(-120, 200, -80);
  scene.add(sun);

  const sea = new Mesh(new CircleGeometry(900, 64), new MeshLambertMaterial({ color: SEA_BLUE }));
  sea.rotation.x = -Math.PI / 2;
  scene.add(sea);
  // The edge of the fight: buoys on the circle a ship must cross to get away.
  const buoys = new InstancedMesh(new SphereGeometry(1.2, 8, 6), new MeshLambertMaterial({ color: 0xf2c94c }), 48);
  const matrix = new Matrix4();
  for (let index = 0; index < 48; index += 1) {
    const angle = (index / 48) * Math.PI * 2;
    matrix.makeTranslation(Math.cos(angle) * SEA_BATTLE_ARENA_RADIUS, 0.6, Math.sin(angle) * SEA_BATTLE_ARENA_RADIUS);
    buoys.setMatrixAt(index, matrix);
  }
  scene.add(buoys);

  let disposed = false;
  const ships = state.ships.map((ship, index) => {
    const node = new Group();
    const standIn = battleShip(shipLength(ship.spec.radius) * 0.92, index > 0);
    node.add(standIn);
    scene.add(node);
    const modelId = models?.ids[index] ?? null;
    if (models !== undefined && modelId !== null) {
      void models.load(modelId).then((source) => {
        if (source === null || disposed) return;
        node.remove(standIn);
        disposeOwned(standIn);
        node.add(fitShipModel(source, shipLength(ship.spec.radius), undefined, draftShareFor(modelId)));
      });
    }
    return node;
  });
  const balls = new InstancedMesh(new SphereGeometry(1.05, 8, 6), new MeshLambertMaterial({ color: 0x3d3833 }), MAX_BALLS);
  balls.count = 0;
  scene.add(balls);

  // Splashes: a column of white water, grown and faded over SPLASH_SECONDS. A pool, reused.
  const splashGeometry = new CylinderGeometry(0.25, 0.9, 1, 8, 1, true);
  const splashes = Array.from({ length: MAX_SPLASHES }, () => {
    const material = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new Mesh(splashGeometry, material);
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, material, born: -1, size: 1 };
  });
  let nextSplash = 0;
  let clock = 0;
  let lastTick = -1;
  const splash = (x: number, z: number, size: number): void => {
    const entry = splashes[nextSplash];
    nextSplash = (nextSplash + 1) % MAX_SPLASHES;
    if (entry === undefined) return;
    entry.mesh.position.set(x, 0, z);
    entry.born = clock;
    entry.size = size;
    entry.mesh.visible = true;
  };

  // The aim: a dashed arc along the predicted flight, and a ring where it lands.
  const aimMaterial = new LineDashedMaterial({ color: 0xffe08a, dashSize: 1.6, gapSize: 1.1, transparent: true, opacity: 0.9, depthTest: false });
  const aimGeometry = new LineGeometry();
  aimGeometry.setAttribute("position", new BufferAttribute(new Float32Array(3 * 128), 3));
  const aimLine = new Line(aimGeometry, aimMaterial);
  aimLine.visible = false;
  aimLine.renderOrder = 5;
  const aimRing = new Mesh(new RingGeometry(2.2, 3, 24), new MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85, depthTest: false }));
  aimRing.rotation.x = -Math.PI / 2;
  aimRing.visible = false;
  aimRing.renderOrder = 5;
  scene.add(aimLine, aimRing);
  let aiming: BattleAim | null = null;
  let shake = 0;

  let cameraX = 0;
  let cameraZ = 60;
  let cameraY = 44;

  function resize(): void {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  resize();

  return {
    render(current, previous, alpha) {
      current.ships.forEach((ship, index) => {
        const node = ships[index];
        if (node === undefined) return;
        const before = previous[index] ?? ship;
        const x = before.x + (ship.x - before.x) * alpha;
        const z = before.z + (ship.z - before.z) * alpha;
        // Headings are turn units; the shorter way round between the two ticks.
        let turn = ship.heading - before.heading;
        if (turn > 2048) turn -= 4096;
        if (turn < -2048) turn += 4096;
        const heading = ((before.heading + turn * alpha) / 4096) * Math.PI * 2;
        node.position.set(x, ship.alive ? 0 : -1.5 - (1 - ship.hull / ship.spec.hullMax), z);
        node.rotation.set(0, -heading, ship.alive ? 0 : 0.5);
        node.visible = ship.alive || current.tick % 40 < 30;
      });
      // A ball is drawn where its flight puts it between the two ticks: back along its velocity.
      const back = (1 - alpha) / SEA_BATTLE_TICK_HZ;
      balls.count = Math.min(MAX_BALLS, current.balls.length);
      for (let index = 0; index < balls.count; index += 1) {
        const ball = current.balls[index];
        if (ball === undefined) continue;
        matrix.makeTranslation(ball.x - ball.vx * back, Math.max(0.3, ball.y - ball.vy * back), ball.z - ball.vz * back);
        balls.setMatrixAt(index, matrix);
      }
      balls.instanceMatrix.needsUpdate = true;

      // This tick's splashes and blows, once.
      const now = performance.now() / 1000;
      clock = now;
      if (current.tick !== lastTick) {
        lastTick = current.tick;
        for (const impact of current.impacts) splash(impact.x, impact.z, impact.ship >= 0 ? 1.8 : 1);
        for (const ram of current.rams) {
          splash(ram.x, ram.z, 2.6);
          if (ram.a === 0 || ram.b === 0) shake = 0.45;
        }
      }
      for (const entry of splashes) {
        if (entry.born < 0) continue;
        const age = (now - entry.born) / SPLASH_SECONDS;
        if (age >= 1) {
          entry.born = -1;
          entry.mesh.visible = false;
          continue;
        }
        const rise = Math.sin(age * Math.PI);
        entry.mesh.scale.set(entry.size * (0.7 + age * 0.8), Math.max(0.05, rise * 3.6 * entry.size), entry.size * (0.7 + age * 0.8));
        entry.mesh.position.y = (rise * 3.6 * entry.size) / 2;
        entry.material.opacity = 0.75 * (1 - age);
      }

      const player = ships[0];
      if (player !== undefined) {
        const heading = -player.rotation.y;
        const fx = Math.cos(heading);
        const fz = Math.sin(heading);
        // Port is a quarter turn anticlockwise of the heading: (fz, -fx); starboard the other way.
        let targetX: number;
        let targetZ: number;
        let lookX = player.position.x;
        let lookZ = player.position.z;
        let height = 44;
        if (aiming === null) {
          targetX = player.position.x - fx * 58;
          targetZ = player.position.z - fz * 58;
        } else {
          const sign = aiming.side === "PORT" ? 1 : -1;
          const sideX = fz * sign;
          const sideZ = -fx * sign;
          // Out over the other beam and a little astern, looking across to where the shot will fall.
          targetX = player.position.x - sideX * 46 - fx * 22;
          targetZ = player.position.z - sideZ * 46 - fz * 22;
          lookX = player.position.x + sideX * 34;
          lookZ = player.position.z + sideZ * 34;
          height = 52;
        }
        cameraX += (targetX - cameraX) * 0.08;
        cameraZ += (targetZ - cameraZ) * 0.08;
        cameraY += (height - cameraY) * 0.08;
        const jolt = shake > 0 ? (Math.random() - 0.5) * shake * 2 : 0;
        shake = Math.max(0, shake - 0.02);
        camera.position.set(cameraX + jolt, cameraY + jolt, cameraZ);
        camera.lookAt(lookX, 0, lookZ);
      }
      renderer.render(scene, camera);
    },
    setAim(aim) {
      aiming = aim;
      if (aim === null || aim.path.length < 2) {
        aimLine.visible = false;
        aimRing.visible = false;
        return;
      }
      const positions = aimGeometry.getAttribute("position") as BufferAttribute;
      const count = Math.min(128, aim.path.length);
      for (let index = 0; index < count; index += 1) {
        const point = aim.path[Math.floor((index * (aim.path.length - 1)) / Math.max(1, count - 1))];
        if (point === undefined) continue;
        positions.setXYZ(index, point.x, Math.max(0.2, point.y), point.z);
      }
      positions.needsUpdate = true;
      aimGeometry.setDrawRange(0, count);
      aimGeometry.computeBoundingSphere();
      aimLine.computeLineDistances();
      aimLine.visible = true;
      aimRing.position.set(aim.landing.x, 0.25, aim.landing.z);
      aimRing.visible = true;
    },
    resize,
    dispose() {
      disposed = true;
      disposeOwned(scene);
      renderer.dispose();
    }
  };
}
