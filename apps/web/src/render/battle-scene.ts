import {
  AmbientLight,
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
  type Object3D
} from "three";
import { SEA_BATTLE_ARENA_RADIUS, type SeaBattleState } from "@happy-farm/domain";
import { fitShipModel, SHARED_SHIP_GEOMETRY } from "./ship-models";

/**
 * The sea fight, drawn (docs/design/NAVAL.md, W5c).
 *
 * Presentation only: it draws a `SeaBattleState` the battle view steps, and decides nothing. Ships
 * are placed between the last two simulation ticks (`alpha`) so a 20 Hz fight moves smoothly at the
 * screen's own rate. The camera rides behind the player's ship.
 *
 * Each ship draws with its class's model (`render/ship-models.ts`) once the model library has it; a
 * plain block ship stands in until then, so a slow download never holds the fight up.
 */

const SEA_BLUE = 0x2d86b8;
const SKY = 0xcfe9f7;
const MAX_BALLS = 160;

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
        node.add(fitShipModel(source, shipLength(ship.spec.radius)));
      });
    }
    return node;
  });
  const balls = new InstancedMesh(new SphereGeometry(0.7, 8, 6), new MeshLambertMaterial({ color: 0x1c1c1c }), MAX_BALLS);
  balls.count = 0;
  scene.add(balls);

  let cameraX = 0;
  let cameraZ = 60;

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
      balls.count = Math.min(MAX_BALLS, current.balls.length);
      for (let index = 0; index < balls.count; index += 1) {
        const ball = current.balls[index];
        if (ball === undefined) continue;
        // A ball's arc: up and down over its flight, for the eye only.
        const height = 1.5 + Math.sin((ball.ticksLeft / 30) * Math.PI) * 4;
        matrix.makeTranslation(ball.x, height, ball.z);
        balls.setMatrixAt(index, matrix);
      }
      balls.instanceMatrix.needsUpdate = true;
      const player = ships[0];
      if (player !== undefined) {
        const heading = player.rotation.y;
        const targetX = player.position.x - Math.cos(-heading) * 55;
        const targetZ = player.position.z - Math.sin(-heading) * 55;
        cameraX += (targetX - cameraX) * 0.08;
        cameraZ += (targetZ - cameraZ) * 0.08;
        camera.position.set(cameraX, 42, cameraZ);
        camera.lookAt(player.position.x, 0, player.position.z);
      }
      renderer.render(scene, camera);
    },
    resize,
    dispose() {
      disposed = true;
      disposeOwned(scene);
      renderer.dispose();
    }
  };
}
