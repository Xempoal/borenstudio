import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { createIcons, ArrowUpRight, ArrowDown, ArrowUp, Plus, Pause, Play } from 'lucide';

createIcons({ icons: { ArrowUpRight, ArrowDown, ArrowUp, Plus, Pause, Play } });
document.querySelector('#year').textContent = new Date().getFullYear();
gsap.registerPlugin(ScrollTrigger);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const motion = gsap.matchMedia();
motion.add('(prefers-reduced-motion: no-preference)', () => {
  gsap.utils.toArray('[data-reveal]').forEach(element => {
    gsap.from(element, { y: 45, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: element, start: 'top 94%', once: true } });
  });
  gsap.utils.toArray('.project-image').forEach(element => {
    gsap.fromTo(element.querySelector('img'), { yPercent: 6, scale: .96 }, { yPercent: -6, scale: 1.02, ease: 'none', scrollTrigger: { trigger: element, start: 'top bottom', end: 'bottom top', scrub: 1 } });
  });
});
document.querySelectorAll('details').forEach(detail => detail.addEventListener('toggle', () => ScrollTrigger.refresh()));
document.fonts.ready.then(() => ScrollTrigger.refresh());

function createSculpture() {
  const canvas = document.querySelector('#sculpture');
  const container = canvas.parentElement;
  const hero = document.querySelector('.hero');
  const control = document.querySelector('.motion-control');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .95;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, .1, 50);
  camera.position.set(0, 0, 10);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x64702b, 1));
  const key = new THREE.DirectionalLight(0xeaffae, 2);
  key.position.set(-3, 5, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 2);
  rim.position.set(5, -2, 3);
  scene.add(rim);

  // The B is modeled for the studio, with two counters and a silver inset spine.
  const shape = new THREE.Shape();
  shape.moveTo(-1.05, -1.6);
  shape.lineTo(-1.05, 1.6);
  shape.lineTo(.1, 1.6);
  shape.bezierCurveTo(1.55, 1.6, 1.65, .35, .68, .08);
  shape.bezierCurveTo(1.95, -.15, 1.65, -1.6, .15, -1.6);
  shape.closePath();
  const upper = new THREE.Path();
  upper.moveTo(-.32, .43); upper.lineTo(.07, .43);
  upper.bezierCurveTo(.7, .43, .7, 1.02, .07, 1.02);
  upper.lineTo(-.32, 1.02); upper.closePath();
  const lower = new THREE.Path();
  lower.moveTo(-.32, -1.01); lower.lineTo(.15, -1.01);
  lower.bezierCurveTo(.85, -1.01, .85, -.35, .15, -.35);
  lower.lineTo(-.32, -.35); lower.closePath();
  shape.holes.push(upper, lower);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: .65, bevelEnabled: true, bevelSegments: 5, steps: 1, bevelSize: .12, bevelThickness: .12, curveSegments: 36 });
  geometry.center();
  const material = new THREE.MeshPhysicalMaterial({ color: 0xc8f333, metalness: .72, roughness: .23, clearcoat: 1, clearcoatRoughness: .15 });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, material));
  const spine = new THREE.Mesh(new THREE.BoxGeometry(.09, 2.95, .77), new THREE.MeshStandardMaterial({ color: 0xf5ffe5, metalness: .95, roughness: .17 }));
  spine.position.set(-1.14, 0, 0);
  group.add(spine);
  scene.add(group);
  let width = 0;
  let active = true;
  let paused = reduced.matches;
  let elapsed = 0;
  let previous = 0;
  let frame = 0;
  let progress = 0;
  const pointer = { x: 0, y: 0 };
  const eased = { x: 0, y: 0 };

  function render(time = 0) {
    frame = 0;
    const delta = previous ? Math.min((time - previous) / 1000, .05) : 0;
    previous = time;
    if (!paused && !reduced.matches) elapsed += delta;
    eased.x += (pointer.x - eased.x) * .04;
    eased.y += (pointer.y - eased.y) * .04;
    const mobile = width <= 700;
    const moving = !paused && !reduced.matches;
    group.position.set(mobile ? .25 : camera.aspect * 1.4, mobile ? .8 : .05, 0);
    group.scale.setScalar(mobile ? .4 : 1.05);
    group.rotation.set(.12 + (moving ? eased.y * .12 : 0), -.48 + (moving ? Math.sin(elapsed * .45) * .17 + eased.x * .2 + progress * .95 : 0), -.17 + (moving ? Math.sin(elapsed * .3) * .04 + progress * .18 : 0));
    if (moving) group.position.y += Math.sin(elapsed * .7) * .055 - progress * .35;
    renderer.render(scene, camera);
    if (active && !document.hidden && moving) frame = requestAnimationFrame(render);
  }
  function requestRender() {
    if (!frame && active && !document.hidden) frame = requestAnimationFrame(render);
  }
  function resize() {
    width = container.clientWidth;
    camera.aspect = width / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(width, container.clientHeight, false);
    requestRender();
  }
  new ResizeObserver(resize).observe(container);
  new IntersectionObserver(([entry]) => {
    active = entry.isIntersecting;
    if (!active) { cancelAnimationFrame(frame); frame = 0; previous = 0; }
    else requestRender();
  }).observe(hero);
  hero.addEventListener('pointermove', event => {
    pointer.x = (event.clientX / width - .5) * 2;
    pointer.y = (event.clientY / container.clientHeight - .5) * 2;
  }, { passive: true });
  hero.addEventListener('pointerleave', () => { pointer.x = 0; pointer.y = 0; });
  ScrollTrigger.create({ trigger: hero, start: 'top top', end: 'bottom top', onUpdate: self => { progress = self.progress; } });
  function updateControl() {
    const stopped = paused || reduced.matches;
    control.setAttribute('aria-pressed', String(stopped));
    const label = stopped ? 'Reanudar animación' : 'Pausar animación';
    control.setAttribute('aria-label', label);
    control.title = label;
    control.innerHTML = `<i data-lucide="${stopped ? 'play' : 'pause'}" aria-hidden="true"></i>`;
    createIcons({ icons: { Play, Pause } });
    control.hidden = reduced.matches;
    requestRender();
  }
  control.addEventListener('click', () => { paused = !paused; updateControl(); });
  reduced.addEventListener('change', () => { paused = reduced.matches; updateControl(); });
  document.addEventListener('visibilitychange', () => {
    previous = 0;
    if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
    else requestRender();
  });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    cancelAnimationFrame(frame);
    active = false;
    frame = 0;
    container.classList.remove('ready');
    control.hidden = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    active = true;
    container.classList.add('ready');
    updateControl();
  });
  resize();
  container.classList.add('ready');
  updateControl();
}
createSculpture();
