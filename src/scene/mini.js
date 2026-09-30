import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { materials, palette, textures } from './materials.js';

// One offscreen WebGL renderer draws every small scene (the process loops and
// the service card renders) and copies each frame into its own 2D canvas, so
// the page never holds more than two WebGL contexts.

let shared = null;
function getRenderer() {
  if (shared) return shared;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .03).texture;
  room.dispose();
  pmrem.dispose();
  shared = { renderer, environment };
  return shared;
}

function baseScene({ shadowFloor = false, floorMaterial = null } = {}) {
  const { environment } = getRenderer();
  const scene = new THREE.Scene();
  scene.environment = environment;
  scene.environmentIntensity = .9;
  const key = new THREE.DirectionalLight(0xffffff, 2.3);
  key.position.set(-4, 8, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 30 });
  key.shadow.radius = 6;
  key.shadow.blurSamples = 16;
  key.shadow.bias = -.0005;
  key.shadow.normalBias = .02;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, .5);
  fill.position.set(5, 2, 4);
  scene.add(fill);
  if (shadowFloor || floorMaterial) {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorMaterial ?? new THREE.ShadowMaterial({ opacity: .3 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
  }
  return scene;
}

const boxGeometries = new Map();
function roundedBox(w, h, d, r = .04) {
  const id = [w, h, d, r].join();
  if (!boxGeometries.has(id)) boxGeometries.set(id, new RoundedBoxGeometry(w, h, d, 4, r));
  return boxGeometries.get(id);
}
const surface = name => (name === 'terrazzo' || name === 'basalt' || name === 'wood') ? materials[name]() : name === 'screen' ? materials.screen() : materials.resin(name);
// BoxGeometry face order: +x, -x, +y (top), -y, +z, -z.
function block(w, h, d, sides, top = sides, r) {
  const side = surface(sides);
  const mesh = new THREE.Mesh(roundedBox(w, h, d, r), [side, side, surface(top), side, side, side]);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
// CylinderGeometry groups: side, top, bottom.
function cylinder(radius, h, sides, top = sides, segments = 48, thetaStart = 0, thetaLength = Math.PI * 2) {
  const side = surface(sides);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, h, segments, 1, false, thetaStart, thetaLength), [side, surface(top), side]);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// Process loops: clusters of blocks that keep rearranging.

function clusterTalk() {
  const group = new THREE.Group();
  const specs = [
    ['terrazzo', 'pink'], ['wood', 'green'], ['terrazzo', 'terrazzo'],
    ['basalt', 'orange'], ['terrazzo', 'cyan'], ['wood', 'wood'],
    ['terrazzo', 'green'], ['basalt', 'basalt'], ['wood', 'pink'],
  ];
  const items = specs.map(([sides, top], i) => {
    const x = (i % 3 - 1) * .56;
    const z = (Math.floor(i / 3) - 1) * .56;
    const mesh = block(.52, 1, .52, sides, top, .03);
    mesh.position.set(x, 0, z);
    group.add(mesh);
    return { mesh, phase: i * .9, base: .7 + ((i * 37) % 7) / 10 };
  });
  return {
    group,
    update(t) {
      items.forEach(item => {
        const h = item.base + Math.sin(t * .9 + item.phase) * .28;
        item.mesh.scale.y = h;
        item.mesh.position.y = h / 2;
      });
      group.rotation.y = .6 + Math.sin(t * .25) * .35;
    },
  };
}

function clusterBuild() {
  const group = new THREE.Group();
  const base = [['terrazzo', 'terrazzo'], ['wood', 'wood'], ['basalt', 'basalt'], ['terrazzo', 'green']].map(([sides, top], i) => {
    const plate = block(.62, .22, .62, sides, top, .03);
    plate.position.set((i % 2 - .5) * .66, .11, (Math.floor(i / 2) - .5) * .66);
    group.add(plate);
    return plate;
  });
  // Blocks drop one after another onto the stack, then the stack resets.
  const stack = [['terrazzo', 'pink'], ['wood', 'wood'], ['basalt', 'orange'], ['terrazzo', 'cyan']].map(([sides, top]) => {
    const piece = block(.56, .34, .56, sides, top, .035);
    group.add(piece);
    return piece;
  });
  const bounce = t => {
    if (t < 1 / 2.75) return 7.5625 * t * t;
    if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + .75;
    return 7.5625 * (t -= 2.25 / 2.75) * t + .9375;
  };
  return {
    group,
    update(t) {
      const cycle = (t % 5.2) / 5.2 * 6.5;
      stack.forEach((piece, i) => {
        const local = Math.min(1, Math.max(0, cycle - i * 1.1));
        const rest = .22 + .17 + i * .35;
        const leave = Math.max(0, cycle - 5.6) / .9;
        piece.position.set(.33, rest + (1 - bounce(local)) * 2.2 + leave * 2.4, .33);
        piece.rotation.y = (1 - local) * 1.2 + i * .12;
        piece.scale.setScalar(local > 0 ? 1 - leave : 0);
      });
      group.rotation.y = .5 + Math.sin(t * .25) * .3;
    },
  };
}

function clusterCare() {
  const group = new THREE.Group();
  const drum = cylinder(.3, .7, 'wood', 'wood');
  drum.position.set(-.45, .35, .2);
  const tower = block(.5, 1.25, .5, 'terrazzo', 'cyan', .03);
  tower.position.set(.12, .625, -.2);
  const low = block(.5, .5, .5, 'basalt', 'basalt', .03);
  low.position.set(.55, .25, .35);
  const small = block(.34, .34, .34, 'terrazzo', 'pink', .03);
  small.position.set(-.1, .17, .6);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.2, 48, 32), materials.terrazzo());
  ball.castShadow = true;
  const stripes = cylinder(.26, .52, 'terrazzo', 'orange');
  stripes.position.set(-.55, .26, -.45);
  group.add(drum, tower, low, small, ball, stripes);
  return {
    group,
    update(t) {
      const bounce = Math.abs(Math.sin(t * 1.6));
      ball.position.set(.12, 1.45 + bounce * .35, -.2);
      small.position.y = .17 + Math.max(0, Math.sin(t * .8)) * .25;
      small.rotation.y = t * .6;
      drum.rotation.y = t * .3;
      group.rotation.y = -.4 + Math.sin(t * .3) * .4;
    },
  };
}

export function createClusters(canvases) {
  const { renderer } = getRenderer();
  const builders = [clusterTalk, clusterBuild, clusterCare];
  const views = [...canvases].map((canvas, i) => {
    const scene = baseScene({ shadowFloor: false });
    const cluster = builders[i % builders.length]();
    scene.add(cluster.group);
    const camera = new THREE.PerspectiveCamera(22, 1, .1, 50);
    camera.position.set(0, 5, 7.2);
    camera.lookAt(0, .7, 0);
    return { canvas, ctx: canvas.getContext('2d'), scene, cluster, camera, visible: false };
  });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let time = 0;
  let previous = 0;

  function sizeCanvas(view) {
    const rect = view.canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio, 2);
    const w = Math.round(rect.width * dpr);
    if (view.canvas.width !== w) { view.canvas.width = w; view.canvas.height = w; }
    return w;
  }

  function render(stamp = 0) {
    frame = 0;
    const delta = previous ? Math.min((stamp - previous) / 1000, .05) : 0;
    previous = stamp;
    if (!reduced.matches) time += delta;
    let any = false;
    for (const view of views) {
      if (!view.visible) continue;
      any = true;
      const size = sizeCanvas(view);
      if (!size) continue;
      renderer.setPixelRatio(1);
      renderer.setSize(size, size, false);
      view.cluster.update(time + views.indexOf(view) * 2);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(view.scene, view.camera);
      view.ctx.clearRect(0, 0, size, size);
      view.ctx.drawImage(renderer.domElement, 0, 0);
    }
    if (any && !reduced.matches && !document.hidden) frame = requestAnimationFrame(render);
  }
  const request = () => { if (!frame) { previous = 0; frame = requestAnimationFrame(render); } };
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => { views.find(view => view.canvas === entry.target).visible = entry.isIntersecting; });
    request();
  }, { rootMargin: '120px' });
  views.forEach(view => observer.observe(view.canvas));
  document.addEventListener('visibilitychange', request);
}

// ---------------------------------------------------------------------------
// Service card renders: one still per card, isometric object on warm concrete
// with a colored slab in the corner.

function gearShape(teeth, outer, inner, hole) {
  const shape = new THREE.Shape();
  const step = Math.PI * 2 / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const points = [[inner, a], [outer, a + step * .18], [outer, a + step * .5], [inner, a + step * .68]];
    points.forEach(([r, angle], j) => {
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0 && j === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    });
  }
  shape.closePath();
  const circle = new THREE.Path();
  circle.absarc(0, 0, hole, 0, Math.PI * 2, true);
  shape.holes.push(circle);
  return shape;
}
function gear(teeth, outer, sides, top) {
  const geometry = new THREE.ExtrudeGeometry(gearShape(teeth, outer, outer * .8, outer * .3), { depth: .22, bevelEnabled: true, bevelThickness: .03, bevelSize: .03, bevelSegments: 3, curveSegments: 24 });
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, [surface(top), surface(sides)]);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

const cardBuilders = [
  // Landing pages: a wooden tablet with a live page on screen.
  () => {
    const g = new THREE.Group();
    const body = block(2.3, .18, 1.55, 'wood', 'wood', .08);
    body.position.y = .09;
    const screen = block(2, .06, 1.25, 'basalt', 'screen', .03);
    screen.position.y = .19;
    const hero = block(1.1, .05, .22, 'lime', 'lime', .02);
    hero.position.set(-.35, .23, -.3);
    const line1 = block(1.3, .04, .09, 'terrazzo', 'terrazzo', .02);
    line1.position.set(-.25, .23, -.02);
    const line2 = block(.9, .04, .09, 'terrazzo', 'terrazzo', .02);
    line2.position.set(-.45, .23, .15);
    const cta = block(.5, .09, .22, 'green', 'green', .04);
    cta.position.set(-.6, .25, .4);
    const pic = block(.55, .05, .55, 'pink', 'pink', .03);
    pic.position.set(.62, .23, .12);
    g.add(body, screen, hero, line1, line2, cta, pic);
    return { group: g, band: 'green' };
  },
  // Sites & blogs: stacked pages.
  () => {
    const g = new THREE.Group();
    ['basalt', 'wood', 'terrazzo'].forEach((m, i) => {
      const page = block(1.9, .14, 1.35, m, m, .05);
      page.position.set(-i * .16, .07 + i * .16, i * .14);
      page.rotation.y = i * .06;
      g.add(page);
    });
    const tab = block(.5, .08, .26, 'pink', 'pink', .03);
    tab.position.set(-.55, .5, -.15);
    const l1 = block(1.1, .04, .08, 'basalt', 'basalt', .02);
    l1.position.set(-.2, .48, .2);
    const l2 = block(.8, .04, .08, 'basalt', 'basalt', .02);
    l2.position.set(-.35, .48, .4);
    g.add(tab, l1, l2);
    return { group: g, band: 'pink' };
  },
  // Online stores: an open shipping box with a tag inside.
  () => {
    const g = new THREE.Group();
    const w = 1.5;
    const h = .7;
    const t = .06;
    const base = block(w, t, w, 'basalt', 'basalt', .02);
    base.position.y = t / 2;
    g.add(base);
    [[0, w / 2], [0, -w / 2], [w / 2, 0], [-w / 2, 0]].forEach(([x, z], i) => {
      const wall = block(i < 2 ? w : t, h, i < 2 ? t : w, 'basalt', 'basalt', .02);
      wall.position.set(x, h / 2, z);
      g.add(wall);
      const flap = block(i < 2 ? w : .6, t, i < 2 ? .6 : w, 'basalt', 'basalt', .02);
      const out = .3;
      flap.position.set(x + Math.sign(x) * out, h + .12, z + Math.sign(z) * out);
      flap.rotation.set(i < 2 ? Math.sign(z) * .55 : 0, 0, i >= 2 ? -Math.sign(x) * .55 : 0);
      g.add(flap);
    });
    const tag = block(.55, .75, .12, 'cyan', 'cyan', .05);
    tag.position.set(0, .75, 0);
    tag.rotation.set(-.25, .5, .2);
    g.add(tag);
    return { group: g, band: 'cyan' };
  },
  // Apps: a phone with app tiles.
  () => {
    const g = new THREE.Group();
    const phone = block(1.05, .14, 2, 'wood', 'wood', .14);
    phone.position.y = .07;
    const screen = block(.9, .05, 1.8, 'basalt', 'screen', .1);
    screen.position.y = .15;
    g.add(phone, screen);
    ['yellow', 'pink', 'green', 'cyan', 'orange', 'lemon'].forEach((c, i) => {
      const tile = block(.3, .1, .3, c, c, .06);
      tile.position.set((i % 2 - .5) * .42, .21 + (i === 0 ? .1 : 0), (Math.floor(i / 2) - 1) * .44 - .1);
      g.add(tile);
    });
    g.rotation.y = .5;
    return { group: g, band: 'yellow' };
  },
  // SaaS: a layered pie chart.
  () => {
    const g = new THREE.Group();
    const slices = [[0, 2.1, .32, 'green'], [2.1, 1.5, .22, 'terrazzo'], [3.6, 1.2, .26, 'basalt'], [4.8, 1.48, .18, 'mint']];
    const base = cylinder(1.12, .18, 'wood', 'wood', 72);
    base.position.y = .09;
    g.add(base);
    slices.forEach(([start, length, h, c]) => {
      const s = cylinder(1.05, h, 'wood', c, 72, start, length);
      s.position.y = .18 + h / 2;
      g.add(s);
    });
    return { group: g, band: 'orange' };
  },
  // Automation: interlocking gears.
  () => {
    const g = new THREE.Group();
    const a = gear(12, .78, 'terrazzo', 'terrazzo');
    a.position.set(-.45, .03, 0);
    const b = gear(9, .56, 'yellow', 'yellow');
    b.position.set(.72, .03, .38);
    b.rotation.y = .3;
    const c = block(.3, .3, .3, 'blue', 'blue', .05);
    c.position.set(.55, .15, -.6);
    const axle = cylinder(.12, .5, 'basalt', 'basalt');
    axle.position.set(-.45, .25, 0);
    g.add(a, b, c, axle);
    return { group: g, band: 'blue' };
  },
];

export function renderCards(canvases) {
  const { renderer } = getRenderer();
  const concrete = textures.terrazzo().clone();
  concrete.repeat.set(5, 5);
  concrete.needsUpdate = true;
  const floorMaterial = new THREE.MeshStandardMaterial({ color: '#dedcd8', map: concrete, roughness: .95 });
  [...canvases].forEach((canvas, i) => {
    const build = cardBuilders[i % cardBuilders.length];
    const scene = baseScene({ floorMaterial });
    const { group, band } = build();
    scene.add(group);
    const slab = block(6, .3, 6, band, band, .02);
    slab.rotation.y = .5;
    slab.position.set(4.3, -.12, 1.9);
    slab.receiveShadow = true;
    scene.add(slab);
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio, 2);
    const w = Math.round((rect.width || 416) * dpr);
    const h = Math.round((rect.height || 212) * dpr);
    canvas.width = w;
    canvas.height = h;
    const camera = new THREE.PerspectiveCamera(24, w / h, .1, 60);
    const wide = w / h > 1.4;
    camera.position.set(wide ? 3.4 : 4.2, wide ? 4.3 : 5.4, wide ? 4.1 : 5.1);
    camera.lookAt(0, .2, 0);
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    renderer.setClearColor(0xd9d9d9, 1);
    renderer.clear();
    renderer.render(scene, camera);
    canvas.getContext('2d').drawImage(renderer.domElement, 0, 0);
    canvas.classList.add('rendered');
  });
}
