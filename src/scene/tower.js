import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { gsap } from 'gsap';
import { materials, palette, wordmark } from './materials.js';

// Hero: a hexagonal column built from wedge-shaped blocks. Blocks keep flying
// out and new ones fly in, so the tower is always assembling itself. A
// mirrored pass fades into the floor like a product shot on a glossy surface.

const LAYERS = 6;
const SEGMENTS = 6;
const OUTER = .8;
const INNER = .34;
const HEIGHT = .43;
const V_GAP = .022;
const GAP = .04;
const BEVEL = .035;
const STEP = HEIGHT + V_GAP;

function wedgeGeometry() {
  const half = Math.PI / SEGMENTS;
  const corner = (radius, angle) => new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius);
  const offset = (point, angle, sign) => point.clone().add(new THREE.Vector2(Math.sin(angle) * sign, -Math.cos(angle) * sign).multiplyScalar(GAP / 2));
  const shape = new THREE.Shape([
    offset(corner(INNER, -half), -half, -1),
    offset(corner(OUTER, -half), -half, -1),
    offset(corner(OUTER, half), half, 1),
    offset(corner(INNER, half), half, 1),
  ]);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: HEIGHT - BEVEL * 2,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelOffset: -BEVEL,
    bevelSegments: 5,
    curveSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -(HEIGHT - BEVEL * 2) / 2, 0);
  const centerX = (OUTER + INNER) / 2 * Math.cos(half);
  geometry.translate(-centerX, 0, 0);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  // Decals sit on the real outer face, which the gap offset nudges outward.
  return { geometry, centerX, outerFace: geometry.boundingBox.max.x, faceWidth: OUTER * Math.sin(half) * 2 - GAP };
}

const LABELS = [
  { text: 'afluya', font: '800 200px "Inter Tight"', tracking: -8 },
  { text: 'LOURNAR', font: '400 170px Georgia, "Times New Roman", serif', tracking: 18 },
  { text: 'PidoYa', font: '800 190px "Inter Tight"', tracking: -6 },
  { text: 'VANDEERHATS', font: '800 190px Archivo', tracking: 2 },
  { text: 'boren', font: '800 210px "Inter Tight"', tracking: -10 },
  { text: 'mi roperito', font: 'italic 700 170px Georgia, "Times New Roman", serif', tracking: -2 },
  { text: 'RULETA', font: '800 200px Archivo', tracking: 10 },
];

const COLORS = ['yellow', 'yellow', 'green', 'pink', 'cyan', 'lemon', 'mint', 'orange', 'red', 'blue', 'lime'];

function pick(list, rand = Math.random) {
  return list[Math.floor(rand() * list.length)];
}

function randomKind() {
  const roll = Math.random();
  if (roll < .26) return { sides: 'terrazzo', caps: 'terrazzo', label: true, ink: '#161616' };
  if (roll < .36) return { sides: 'terrazzo', caps: pick(COLORS), label: true, ink: '#161616' };
  if (roll < .5) return { sides: 'basalt', caps: 'basalt', label: true, ink: '#f4f4f4' };
  if (roll < .66) return { sides: 'wood', caps: 'wood', label: true, ink: '#2a1a0c' };
  return { sides: pick(COLORS), caps: null, label: false };
}

function surface(name) {
  if (name === 'terrazzo' || name === 'basalt' || name === 'wood') return materials[name]();
  return materials.resin(name);
}

export function createTower(canvas, { onReady } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  const small = matchMedia('(max-width: 860px)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;
  renderer.localClippingEnabled = false;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, .03).texture;
  scene.environmentIntensity = .5;
  room.dispose();
  pmrem.dispose();

  const key = new THREE.DirectionalLight(0xffffff, 3);
  key.position.set(-5, 9, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 5, bottom: -3, near: 1, far: 30 });
  key.shadow.radius = 5;
  key.shadow.blurSamples = 16;
  key.shadow.bias = -.0004;
  key.shadow.normalBias = .02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, .7);
  rim.position.set(6, 3, -2);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, .45);
  fill.position.set(3, 2, 8);
  scene.add(fill);

  const world = new THREE.Group();
  const tower = new THREE.Group();
  world.add(tower);
  scene.add(world);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: .16 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Fade plane between the reflection and the real tower.
  const fadeScene = new THREE.Scene();
  const fadeTexture = (() => {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgb(150,150,150)');
    gradient.addColorStop(.16, 'rgb(175,175,175)');
    gradient.addColorStop(.36, 'rgb(235,235,235)');
    gradient.addColorStop(.5, 'rgb(255,255,255)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  })();
  const fade = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshBasicMaterial({ color: 0xe5e5e5, alphaMap: fadeTexture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  fade.rotation.x = -Math.PI / 2;
  fadeScene.add(fade);

  const { geometry, centerX, outerFace, faceWidth } = wedgeGeometry();
  const decalGeometry = new THREE.PlaneGeometry(faceWidth * .8, faceWidth * .8 * .375);
  const decalMaterials = new Map();
  function decalMaterial(label, ink) {
    const id = `${label.text}-${ink}`;
    if (!decalMaterials.has(id)) {
      decalMaterials.set(id, new THREE.MeshStandardMaterial({
        map: wordmark(label.text, { font: label.font, color: ink, tracking: label.tracking }),
        transparent: true, depthWrite: false, roughness: .55, polygonOffset: true, polygonOffsetFactor: -2,
      }));
    }
    return decalMaterials.get(id);
  }

  const slotPosition = (layer, segment) => {
    const angle = segment * (Math.PI * 2 / SEGMENTS);
    return {
      angle,
      position: new THREE.Vector3(Math.cos(angle) * centerX, HEIGHT / 2 + layer * STEP, Math.sin(angle) * centerX),
      outward: new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)),
    };
  };

  function makePiece() {
    const kind = randomKind();
    const sides = surface(kind.sides);
    const caps = kind.caps ? surface(kind.caps) : sides;
    const mesh = new THREE.Mesh(geometry, [caps, sides]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (kind.label && Math.random() < .6) {
      const decal = new THREE.Mesh(decalGeometry, decalMaterial(pick(LABELS), kind.ink));
      decal.position.set(outerFace + .003, 0, 0);
      decal.rotation.y = Math.PI / 2;
      mesh.add(decal);
    }
    return mesh;
  }

  // --- choreography ------------------------------------------------------
  const slots = [];
  for (let layer = 0; layer < LAYERS; layer++) {
    for (let segment = 0; segment < SEGMENTS; segment++) slots.push({ layer, segment, piece: null, busy: false, ...slotPosition(layer, segment) });
  }
  const flights = [];
  let clock = 0;
  const easeIn = gsap.parseEase('power2.in');
  const easeOut = gsap.parseEase('expo.out');
  const easeBack = gsap.parseEase('back.out(1.2)');

  function flyIn(slot, delay = 0) {
    const mesh = makePiece();
    const distance = 1.8 + Math.random() * 1.4;
    const from = slot.position.clone().addScaledVector(slot.outward, distance);
    from.y += Math.random() * 2.2;
    const spin = new THREE.Euler((Math.random() - .5) * 4, (Math.random() - .5) * 3, (Math.random() - .5) * 4);
    mesh.position.copy(from);
    mesh.scale.setScalar(0);
    tower.add(mesh);
    slot.busy = true;
    flights.push({
      mesh, start: clock + delay, duration: 1.25 + Math.random() * .5,
      update(t) {
        const e = easeOut(t);
        mesh.position.lerpVectors(from, slot.position, e);
        mesh.position.y += Math.sin(Math.PI * Math.min(1, t * 1.1)) * .35 * (1 - e);
        mesh.rotation.set(spin.x * (1 - e), -slot.angle + spin.y * (1 - e), spin.z * (1 - e));
        mesh.scale.setScalar(easeBack(Math.min(1, t * 2.4)));
      },
      done() {
        slot.piece = mesh;
        slot.busy = false;
        // The crown stays a little unruly, like blocks that just landed.
        if (slot.layer === LAYERS - 1 && Math.random() < .5) {
          mesh.position.y += .04 + Math.random() * .1;
          mesh.rotation.x = (Math.random() - .5) * .16;
          mesh.rotation.z = (Math.random() - .5) * .16;
        }
      },
    });
  }

  function flyOut(slot, delay = 0) {
    const mesh = slot.piece;
    if (!mesh) return;
    slot.piece = null;
    slot.busy = true;
    const from = slot.position.clone();
    const to = from.clone().addScaledVector(slot.outward, 2 + Math.random() * 1.2);
    to.y += -.2 + Math.random() * 1.8;
    const spin = new THREE.Euler((Math.random() - .5) * 5, (Math.random() - .5) * 4, (Math.random() - .5) * 5);
    flights.push({
      mesh, start: clock + delay, duration: 1.05 + Math.random() * .35,
      update(t) {
        const e = easeIn(t);
        mesh.position.lerpVectors(from, to, e);
        mesh.position.y += Math.sin(Math.PI * t) * .25;
        mesh.rotation.set(spin.x * e, -slot.angle + spin.y * e, spin.z * e);
        mesh.scale.setScalar(t < .6 ? 1 : 1 - easeIn((t - .6) / .4));
      },
      done() { tower.remove(mesh); },
    });
  }

  function swap(list, stagger = .06) {
    list.forEach((slot, index) => {
      flyOut(slot, index * stagger);
      flyIn(slot, .55 + index * stagger);
    });
  }

  let nextEvent = 0;
  function schedule() {
    const free = slots.filter(slot => !slot.busy && slot.piece);
    if (free.length < 4) return;
    const roll = Math.random();
    if (roll < .38) {
      const layer = Math.floor(Math.random() * LAYERS);
      swap(free.filter(slot => slot.layer === layer));
    } else if (roll < .62) {
      const segment = Math.floor(Math.random() * SEGMENTS);
      swap(free.filter(slot => slot.segment === segment || slot.segment === (segment + 1) % SEGMENTS).sort(() => Math.random() - .5).slice(0, 4), .08);
    } else {
      swap(free.sort(() => Math.random() - .5).slice(0, 2 + Math.floor(Math.random() * 3)), .1);
    }
  }

  // Build the column from the ground up.
  slots.forEach((slot, index) => flyIn(slot, .35 + slot.layer * .28 + (index % SEGMENTS) * .05));
  nextEvent = .35 + LAYERS * .28 + 1.4;

  // --- camera & render -----------------------------------------------------
  const camera = new THREE.PerspectiveCamera(19, 1, .1, 100);
  const target = new THREE.Vector3(0, 1.95, 0);
  const pointer = { x: 0, y: 0 };
  const eased = { x: 0, y: 0 };
  addEventListener('pointermove', event => {
    pointer.x = event.clientX / innerWidth - .5;
    pointer.y = event.clientY / innerHeight - .5;
  }, { passive: true });

  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.userData.small = width < 600;
    camera.updateProjectionMatrix();
  }

  const mirrorPlane = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)];
  let paused = false;
  let visible = true;
  let frame = 0;
  let previous = 0;
  let spinAngle = .25;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  function draw() {
    const distance = camera.userData.small ? 12.6 : 13.9;
    const elevation = .43 + eased.y * .05;
    const azimuth = eased.x * .18;
    camera.position.set(Math.sin(azimuth) * Math.cos(elevation) * distance, target.y + Math.sin(elevation) * distance, Math.cos(azimuth) * Math.cos(elevation) * distance);
    camera.lookAt(target);
    tower.rotation.y = spinAngle;

    renderer.clear();
    // Reflection.
    world.scale.y = -1;
    ground.visible = false;
    renderer.clippingPlanes = mirrorPlane;
    renderer.render(scene, camera);
    renderer.clippingPlanes = [];
    world.scale.y = 1;
    ground.visible = true;
    renderer.render(fadeScene, camera);
    renderer.clearDepth();
    renderer.render(scene, camera);
  }

  function tick(time) {
    frame = 0;
    const delta = previous ? Math.min((time - previous) / 1000, .05) : 0;
    previous = time;
    const still = paused || reduced.matches;
    if (!still) {
      clock += delta;
      spinAngle += delta * .16;
      if (clock > nextEvent) {
        schedule();
        nextEvent = clock + 1 + Math.random() * .6;
      }
    }
    eased.x += (pointer.x - eased.x) * .04;
    eased.y += (pointer.y - eased.y) * .04;
    for (let i = flights.length - 1; i >= 0; i--) {
      const flight = flights[i];
      const t = (clock - flight.start) / flight.duration;
      if (t < 0) continue;
      if (t >= 1) {
        flight.update(1);
        flight.done();
        flights.splice(i, 1);
      } else flight.update(t);
    }
    draw();
    if (visible && !document.hidden && !still) frame = requestAnimationFrame(tick);
  }

  function request() {
    if (!frame) frame = requestAnimationFrame(tick);
  }

  if (reduced.matches) {
    // Skip straight to the assembled column.
    clock = 10;
  }

  new ResizeObserver(() => { resize(); request(); }).observe(canvas);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    previous = 0;
    if (visible) request();
  }, { rootMargin: '100px' }).observe(canvas);
  document.addEventListener('visibilitychange', () => { previous = 0; if (!document.hidden) request(); });
  reduced.addEventListener('change', request);
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); cancelAnimationFrame(frame); frame = 0; });
  canvas.addEventListener('webglcontextrestored', request);
  resize();
  request();
  onReady?.();

  return {
    get paused() { return paused || reduced.matches; },
    setPaused(value) { paused = value; previous = 0; request(); },
  };
}
