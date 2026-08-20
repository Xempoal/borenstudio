/* Boren Studio — scroll direction and editorial motion */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(pointer: fine)').matches;
  var hero = document.querySelector('.hero');
  var heroTitle = document.querySelector('.hero-title');
  var heroArt = document.querySelector('.tech-orbit');
  var aboutVisual = document.querySelector('.about-visual');
  var aboutImage = aboutVisual && aboutVisual.querySelector('img');
  var projects = [].slice.call(document.querySelectorAll('.proj'));
  var projectImages = projects.map(function (card) { return card.querySelector('img'); });
  var ticking = false;

  /* Small editorial folios reinforce the long-page rhythm. */
  [
    ['#nosotros', '02 / ESTUDIO'],
    ['#proyectos', '03 / TRABAJO'],
    ['#testimonios', '04 / VOCES'],
    ['#faq', '05 / PREGUNTAS']
  ].forEach(function (item) {
    var section = document.querySelector(item[0]);
    if (!section || section.querySelector('.section-index')) return;
    var index = document.createElement('span');
    index.className = 'section-index';
    index.textContent = item[1];
    index.setAttribute('aria-hidden', 'true');
    section.appendChild(index);
  });

  function clamp(min, value, max) {
    return Math.max(min, Math.min(max, value));
  }

  function updateMotion() {
    ticking = false;
    if (reduced) return;

    var viewport = window.innerHeight || 1;

    if (hero) {
      var hr = hero.getBoundingClientRect();
      var heroProgress = clamp(0, -hr.top / Math.max(1, hr.height - viewport), 1);
      if (heroTitle) {
        heroTitle.style.transform = 'translate3d(0,' + (heroProgress * 42) + 'px,0)';
        heroTitle.style.opacity = String(1 - heroProgress * 0.44);
      }
      if (heroArt) {
        heroArt.style.transform = 'translate3d(0,' + (heroProgress * 75) + 'px,0) rotate(' + (heroProgress * 1.5) + 'deg)';
      }
    }

    if (aboutVisual && aboutImage) {
      var ar = aboutVisual.getBoundingClientRect();
      var aboutProgress = clamp(0, (viewport - ar.top) / (viewport + ar.height), 1);
      aboutImage.style.transform = 'scale(1.12) translate3d(0,' + ((aboutProgress - .5) * 8) + '%,0)';
    }

    projects.forEach(function (card, i) {
      var image = projectImages[i];
      if (!image) return;
      var r = card.getBoundingClientRect();
      if (r.bottom < 0 || r.top > viewport) return;
      var centerDelta = (r.top + r.height / 2 - viewport / 2) / viewport;
      image.style.transform = 'scale(1.13) translate3d(0,' + (centerDelta * -8) + '%,0)';
    });
  }

  function requestTick() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(updateMotion);
  }

  window.addEventListener('scroll', requestTick, { passive: true });
  window.addEventListener('resize', requestTick, { passive: true });
  requestTick();

  /* The services track gains height in JavaScript; re-resolve deep links afterwards. */
  if (window.location.hash) {
    window.setTimeout(function () {
      var target = document.querySelector(window.location.hash);
      if (target) target.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    }, 180);
  }

  /* Project-card perspective follows the pointer, then eases home. */
  if (finePointer && !reduced) {
    projects.forEach(function (card) {
      card.addEventListener('mousemove', function (event) {
        var r = card.getBoundingClientRect();
        var x = (event.clientX - r.left) / r.width - .5;
        var y = (event.clientY - r.top) / r.height - .5;
        card.style.transform = 'perspective(1100px) rotateX(' + (y * -2.2) + 'deg) rotateY(' + (x * 2.2) + 'deg)';
      });
      card.addEventListener('mouseleave', function () {
        card.style.transform = '';
      });
    });
  }

  /* Indicate the section currently in view in the desktop navigation. */
  if ('IntersectionObserver' in window) {
    var navLinks = [].slice.call(document.querySelectorAll('.nav-links .link'));
    var sectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navLinks.forEach(function (link) {
          link.classList.toggle('active', link.getAttribute('href') === '#' + entry.target.id);
        });
      });
    }, { rootMargin: '-35% 0px -55% 0px', threshold: 0 });

    ['servicios', 'proyectos', 'nosotros', 'faq'].forEach(function (id) {
      var section = document.getElementById(id);
      if (section) sectionObserver.observe(section);
    });
  }
})();
