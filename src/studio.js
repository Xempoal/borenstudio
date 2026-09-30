import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { createIcons, ArrowUpRight, ArrowRight, ArrowLeft, ArrowUp, Pause, Play, MessageCircle, CreditCard, CalendarCheck, Package, Search, Bell, ChartColumn, Globe } from 'lucide';
import { createTower } from './scene/tower.js';
import { createClusters, renderCards } from './scene/mini.js';

const icons = { ArrowUpRight, ArrowRight, ArrowLeft, ArrowUp, Pause, Play, MessageCircle, CreditCard, CalendarCheck, Package, Search, Bell, ChartColumn, Globe };
createIcons({ icons });
gsap.registerPlugin(ScrollTrigger);
document.querySelector('#year').textContent = new Date().getFullYear();
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const root = document.documentElement;

// --- Smooth scroll ----------------------------------------------------------
let lenis = null;
if (!reduced.matches) {
  lenis = new Lenis({ lerp: .1, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add(time => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}
function scrollTo(target) {
  const offset = innerWidth <= 860 ? -64 : -80;
  if (lenis) lenis.scrollTo(target, { offset, duration: 1.4 });
  else scrollBy({ top: target.getBoundingClientRect().top + offset });
}
document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;
  const target = document.querySelector(link.getAttribute('href'));
  if (!target) return;
  event.preventDefault();
  setMenu(false);
  scrollTo(target);
});

// --- Site intro -------------------------------------------------------------
Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 1200))]).then(() => {
  requestAnimationFrame(() => root.classList.add('loaded'));
});

// --- Nav theme follows the section under it -------------------------------
const nav = document.querySelector('.the-nav');
const themed = [...document.querySelectorAll('[data-nav]')];
function updateNav() {
  const probe = nav.offsetHeight / 2;
  const current = themed.find(section => {
    const rect = section.getBoundingClientRect();
    return rect.top <= probe && rect.bottom > probe;
  });
  // Rounded sections start with a strip of the previous color behind the arc.
  let theme = current?.dataset.nav ?? 'light';
  if (current?.classList.contains('rounded-section')) {
    const arc = current.querySelector('.rs-scale').getBoundingClientRect();
    if (arc.top > probe) theme = current.classList.contains('rs-white') ? 'dark' : 'light';
  }
  if (nav.dataset.theme !== theme) nav.dataset.theme = theme;
}
addEventListener('scroll', updateNav, { passive: true });
lenis?.on('scroll', updateNav);
updateNav();

// --- Mobile menu ------------------------------------------------------------
const burger = document.querySelector('.nav-burger');
const menu = document.querySelector('#menu');
function setMenu(open) {
  burger.setAttribute('aria-expanded', String(open));
  burger.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  menu.hidden = !open;
  if (open) { lenis?.stop(); nav.dataset.theme = 'light'; } else { lenis?.start(); updateNav(); }
}
burger.addEventListener('click', () => setMenu(menu.hidden));
addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) setMenu(false); });

// --- Split headings into lines that slide up --------------------------------
const splits = [...document.querySelectorAll('.split')];
const revealed = new WeakSet();
function split(element) {
  // Titles with hand-written lines (the hero) keep their markup.
  if (element.hasAttribute('data-lines')) {
    element.classList.add('is-split');
    if (!revealed.has(element) && !reduced.matches) gsap.set(element.querySelectorAll('.line'), { yPercent: 110 });
    return;
  }
  const text = element.dataset.text ?? element.textContent.trim().replace(/\s+/g, ' ');
  element.dataset.text = text;
  element.setAttribute('aria-label', text);
  element.innerHTML = text.split(' ').map(word => `<span class="w">${word}</span>`).join(' ');
  const lines = [];
  let top = null;
  element.querySelectorAll('.w').forEach(word => {
    if (word.offsetTop !== top) { top = word.offsetTop; lines.push([]); }
    lines.at(-1).push(word.textContent);
  });
  element.innerHTML = lines.map(line => `<span class="line-wrap" aria-hidden="true"><span class="line">${line.join(' ')}</span></span>`).join(' ');
  element.classList.add('is-split');
  if (revealed.has(element) || reduced.matches) return;
  gsap.set(element.querySelectorAll('.line'), { yPercent: 110 });
}
function reveal(element, delay = 0) {
  revealed.add(element);
  gsap.to(element.querySelectorAll('.line'), { yPercent: 0, duration: 1.1, ease: 'power4.out', stagger: .09, delay });
}
document.fonts.ready.then(() => {
  splits.forEach(split);
  splits.forEach(element => {
    if (reduced.matches) return;
    if (element.closest('.hero-home')) { reveal(element, .75); return; }
    ScrollTrigger.create({ trigger: element, start: 'top 88%', once: true, onEnter: () => reveal(element) });
  });
  ScrollTrigger.refresh();
});
let resizeTimer = 0;
let lastWidth = innerWidth;
addEventListener('resize', () => {
  if (innerWidth === lastWidth) return;
  lastWidth = innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    splits.forEach(element => { const was = revealed.has(element); split(element); if (was || reduced.matches) gsap.set(element.querySelectorAll('.line'), { yPercent: 0 }); });
    ScrollTrigger.refresh();
  }, 200);
});

// Soft fade-up for body copy.
if (!reduced.matches) {
  gsap.from('.hero-home .desc', { y: 24, opacity: 0, duration: 1, ease: 'power3.out', delay: 1.1 });
  gsap.utils.toArray('.cols-3 > li, .manifesto .desc p, .content1 .desc p, .solutions li, .brand-card, .card-track > li').forEach(element => {
    gsap.from(element, { y: 32, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: element, start: 'top 92%', once: true } });
  });
  gsap.from('.laptop', { x: 120, opacity: 0, duration: 1.4, ease: 'power3.out', scrollTrigger: { trigger: '.content1', start: 'top 70%', once: true } });
}

// --- Rounded sections open up as they arrive --------------------------------
if (!reduced.matches) {
  document.querySelectorAll('.rs-scale').forEach(arc => {
    gsap.fromTo(arc, { '--rs-inset': () => `${Math.min(64, innerWidth * .045)}px` }, {
      '--rs-inset': '0px', ease: 'none',
      scrollTrigger: { trigger: arc, start: 'top bottom', end: 'top 20%', scrub: true, invalidateOnRefresh: true },
    });
  });
}

// --- Project carousel (autoplay, pause, pagination) -------------------------
(() => {
  const carousel = document.querySelector('.case-carousel');
  const track = carousel.querySelector('.case-track');
  const slides = [...track.children];
  const dots = [...carousel.querySelectorAll('.pagination button')];
  const play = carousel.querySelector('.carousel-play');
  const delay = 6000;
  carousel.style.setProperty('--autoplay', `${delay}ms`);
  let index = 0;
  let timer = 0;
  let playing = !reduced.matches;
  const goTo = (next, smooth = true) => {
    index = (next + slides.length) % slides.length;
    track.scrollTo({ left: slides[index].offsetLeft - track.firstElementChild.offsetLeft, behavior: smooth ? 'smooth' : 'auto' });
    setActive(index);
  };
  function setActive(active) {
    dots.forEach((dot, i) => {
      const on = i === active;
      if (on && dot.getAttribute('aria-selected') === 'true') return;
      dot.setAttribute('aria-selected', String(on));
      if (on) { dot.style.animation = 'none'; void dot.offsetWidth; dot.style.animation = ''; }
    });
    restart();
  }
  function restart() {
    clearTimeout(timer);
    if (playing) timer = setTimeout(() => goTo(index + 1), delay);
  }
  function setPlaying(value) {
    playing = value;
    carousel.classList.toggle('paused', !playing);
    play.setAttribute('aria-label', playing ? 'Pausar carrusel' : 'Reproducir carrusel');
    play.innerHTML = `<i data-lucide="${playing ? 'pause' : 'play'}" aria-hidden="true"></i>`;
    createIcons({ icons });
    restart();
  }
  dots.forEach((dot, i) => dot.addEventListener('click', () => goTo(i)));
  play.addEventListener('click', () => setPlaying(!playing));
  let scrollTimer = 0;
  track.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const nearest = slides.reduce((best, slide, i) => Math.abs(slide.offsetLeft - track.firstElementChild.offsetLeft - track.scrollLeft) < Math.abs(slides[best].offsetLeft - track.firstElementChild.offsetLeft - track.scrollLeft) ? i : best, 0);
      if (nearest !== index) { index = nearest; setActive(index); }
    }, 120);
  }, { passive: true });
  // Only autoplay while the carousel is on screen.
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) restart(); else clearTimeout(timer);
  }).observe(carousel);
  setPlaying(playing);
  setActive(0);
})();

// --- Service cards carousel ---------------------------------------------------
(() => {
  const track = document.querySelector('.card-track');
  const step = () => (track.firstElementChild.getBoundingClientRect().width + 24);
  document.querySelector('.prev-next .prev').addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }));
  document.querySelector('.prev-next .next').addEventListener('click', () => track.scrollBy({ left: step(), behavior: 'smooth' }));
})();

// --- Tilting integration cards ----------------------------------------------
document.querySelectorAll('.brand-card').forEach(card => {
  card.addEventListener('pointermove', event => {
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - .5;
    const y = (event.clientY - rect.top) / rect.height - .5;
    card.style.setProperty('--ry', `${x * 22}deg`);
    card.style.setProperty('--rx', `${-y * 22}deg`);
  });
  card.addEventListener('pointerleave', () => { card.style.setProperty('--ry', '0deg'); card.style.setProperty('--rx', '0deg'); });
});

// --- Yellow square follows the cursor on the contact blocks -----------------
document.querySelectorAll('.entry-item').forEach(item => {
  item.addEventListener('pointermove', event => {
    const rect = item.getBoundingClientRect();
    item.style.setProperty('--x', `${event.clientX - rect.left}px`);
    item.style.setProperty('--y', `${event.clientY - rect.top}px`);
  });
});

// --- Typewriter on the hero title ------------------------------------------
function createTyping(title) {
  const target = title.querySelector('.typed');
  const phrases = JSON.parse(target.dataset.phrases);
  let index = 0;
  let timer = 0;
  let paused = false;
  let visible = true;
  let mode = 'hold';
  const next = delay => { clearTimeout(timer); timer = setTimeout(step, delay); };
  function step() {
    if (paused || !visible || document.hidden || reduced.matches) { title.classList.remove('typing'); return; }
    const text = target.textContent;
    if (mode === 'hold') { mode = 'delete'; title.classList.add('typing'); next(40); return; }
    if (mode === 'delete') {
      if (text.length) { target.textContent = text.slice(0, -1); next(38); return; }
      index = (index + 1) % phrases.length;
      mode = 'type';
      next(260);
      return;
    }
    const phrase = phrases[index];
    if (text.length < phrase.length) { target.textContent = phrase.slice(0, text.length + 1); next(62 + Math.random() * 45); return; }
    mode = 'hold';
    title.classList.remove('typing');
    next(1900);
  }
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible && !paused) next(600); }).observe(title);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !paused) next(600); });
  next(2800);
  return {
    get paused() { return paused; },
    setPaused(value) {
      paused = value;
      if (paused) {
        clearTimeout(timer);
        // Never freeze on a half-typed word.
        target.textContent = phrases[index];
        mode = 'hold';
        title.classList.remove('typing');
      } else next(1200);
      title.classList.toggle('paused', paused);
    },
  };
}
const typing = createTyping(document.querySelector('.hero-title'));

// --- 3D ---------------------------------------------------------------------
const heroMedia = document.querySelector('.hero-media');
const control = document.querySelector('.motion-control');
let tower = null;
function updateControl() {
  const stopped = reduced.matches || typing.paused;
  const label = stopped ? 'Reanudar animación' : 'Pausar animación';
  control.setAttribute('aria-pressed', String(stopped));
  control.setAttribute('aria-label', label);
  control.title = label;
  control.innerHTML = `<i data-lucide="${stopped ? 'play' : 'pause'}" aria-hidden="true"></i>`;
  createIcons({ icons });
  control.hidden = reduced.matches;
}
// One control pauses both the tower and the rotating title.
control.addEventListener('click', () => {
  const pause = !typing.paused;
  typing.setPaused(pause);
  tower?.setPaused(pause);
  updateControl();
});
reduced.addEventListener('change', updateControl);
updateControl();
Promise.all([document.fonts.load('800 100px "Inter Tight"'), document.fonts.load('800 100px Archivo')]).catch(() => {}).finally(() => {
  tower = createTower(document.querySelector('#tower'), { onReady: () => heroMedia.classList.add('ready') });
  if (!tower) { root.classList.add('no-webgl'); return; }
  tower.setPaused(typing.paused);

  try {
    createClusters(document.querySelectorAll('.cluster'));
    const cards = document.querySelectorAll('.card-media');
    let drawnFor = 0;
    const draw = () => {
      const width = cards[0].getBoundingClientRect().width;
      if (Math.abs(width - drawnFor) < 2) return;
      drawnFor = width;
      renderCards(cards);
    };
    new IntersectionObserver((entries, observer) => {
      if (entries.some(entry => entry.isIntersecting)) { draw(); observer.disconnect(); addEventListener('resize', () => { clearTimeout(draw.t); draw.t = setTimeout(draw, 300); }); }
    }, { rootMargin: '600px' }).observe(document.querySelector('.carousel2'));
  } catch { /* the small scenes are decorative */ }
});
