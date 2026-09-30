import * as THREE from 'three';

// Procedural surfaces shared by every scene: speckled terrazzo, dark basalt,
// light wood and matte colored resin. Generated once at 1024px so they stay
// crisp on 2x screens without shipping image files.

const cache = new Map();

function canvasTexture(key, size, draw, { color = true, repeat = 1 } = {}) {
  if (cache.has(key)) return cache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 8;
  cache.set(key, texture);
  return texture;
}

// Deterministic noise so every visit renders the same stone.
function random(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function speckle(ctx, size, base, flecks, seed) {
  const rand = random(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (const [color, count, min, max] of flecks) {
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const r = min + rand() * (max - min);
      const x = rand() * size;
      const y = rand() * size;
      ctx.beginPath();
      // Irregular chips read as stone, round dots read as print.
      ctx.ellipse(x, y, r, r * (.55 + rand() * .45), rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export const textures = {
  terrazzo: () => canvasTexture('terrazzo', 1024, (ctx, size) => speckle(ctx, size, '#f1f0ec', [
    ['rgba(200,196,188,.9)', 700, 1.6, 4],
    ['rgba(110,108,102,.6)', 1500, 1, 2.6],
    ['rgba(30,30,30,.9)', 1500, 1, 2.4],
    ['#c9a878', 140, 1.2, 2.6],
  ], 7), { repeat: 1.5 }),
  terrazzoBump: () => canvasTexture('terrazzoBump', 1024, (ctx, size) => speckle(ctx, size, '#808080', [
    ['#a8a8a8', 700, 1.6, 4],
    ['#5a5a5a', 1500, 1, 2.6],
    ['#303030', 1500, 1, 2.4],
  ], 7), { color: false, repeat: 1.5 }),
  basalt: () => canvasTexture('basalt', 1024, (ctx, size) => speckle(ctx, size, '#262523', [
    ['rgba(255,255,255,.12)', 2600, .4, 1.1],
    ['rgba(0,0,0,.55)', 1800, .6, 2],
    ['rgba(90,86,80,.5)', 700, 1, 2.6],
  ], 11), { repeat: 2.2 }),
  wood: () => canvasTexture('wood', 1024, (ctx, size) => {
    const rand = random(23);
    const gradient = ctx.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, '#e9cfa5');
    gradient.addColorStop(.5, '#e2c392');
    gradient.addColorStop(1, '#ebd3ab');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    for (let line = 0; line < 70; line++) {
      const y0 = rand() * size;
      const amp = 4 + rand() * 18;
      const freq = .004 + rand() * .01;
      const phase = rand() * 10;
      ctx.strokeStyle = `rgba(${150 + rand() * 30 | 0}, ${95 + rand() * 25 | 0}, ${45 + rand() * 20 | 0}, ${.08 + rand() * .22})`;
      ctx.lineWidth = .6 + rand() * 2.4;
      ctx.beginPath();
      for (let x = -10; x <= size + 10; x += 6) ctx.lineTo(x, y0 + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.1) * amp * .2);
      ctx.stroke();
    }
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = `rgba(120,80,40,${rand() * .06})`;
      ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 6, 1);
    }
  }, { repeat: 1.6 }),
  resin: () => canvasTexture('resin', 512, (ctx, size) => speckle(ctx, size, '#ffffff', [
    ['rgba(0,0,0,.06)', 1400, .5, 1.4],
    ['rgba(255,255,255,.5)', 600, .6, 1.6],
  ], 5)),
};

const materialCache = new Map();
function cached(key, create) {
  if (!materialCache.has(key)) materialCache.set(key, create());
  return materialCache.get(key);
}

export const palette = {
  yellow: '#ffe33b',
  lemon: '#fff27a',
  green: '#35cc58',
  mint: '#b8f5ae',
  pink: '#ff7ce0',
  cyan: '#7fe3f0',
  blue: '#2b8fe8',
  orange: '#ff7a2e',
  red: '#e8402c',
  lime: '#c8f333',
  // Secondary palette for the process loops and service renders.
  lavender: '#b39dff',
  peach: '#ffb38a',
  teal: '#1aa89a',
  amber: '#f2b33d',
  indigo: '#4a5bd6',
  sage: '#a9c9a4',
};

export const materials = {
  terrazzo: () => cached('terrazzo', () => new THREE.MeshStandardMaterial({ map: textures.terrazzo(), bumpMap: textures.terrazzoBump(), bumpScale: 1.2, roughness: .72, metalness: 0 })),
  basalt: () => cached('basalt', () => new THREE.MeshStandardMaterial({ map: textures.basalt(), bumpMap: textures.terrazzoBump(), bumpScale: .8, roughness: .62, metalness: 0 })),
  wood: () => cached('wood', () => new THREE.MeshStandardMaterial({ map: textures.wood(), roughness: .6, metalness: 0 })),
  resin: name => cached(`resin-${name}`, () => new THREE.MeshStandardMaterial({ color: palette[name] ?? name, map: textures.resin(), roughness: .62, metalness: 0 })),
  screen: () => cached('screen', () => new THREE.MeshStandardMaterial({ color: '#101010', roughness: .25, metalness: .1 })),
};

// A wordmark drawn on a transparent canvas, used as a decal on block faces.
export function wordmark(text, { font = '700 150px "Inter Tight"', color = '#111', tracking = 0, width = 1024, height = 384, upper = false } = {}) {
  const key = `wm-${text}-${font}-${color}-${tracking}`;
  return canvasTexture(key, width, ctx => {
    ctx.canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${tracking}px`;
    const label = upper ? text.toUpperCase() : text;
    const measured = ctx.measureText(label).width;
    const scale = Math.min(1, (width * .86) / measured);
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(scale, scale);
    ctx.fillText(label, 0, 0);
    ctx.restore();
  });
}
