/* ============================================================
   SEIRAI LP - interactions
   ============================================================ */
(function () {
  'use strict';

  /* --- ヘッダー：スクロールで背景をつける --- */
  var header = document.getElementById('header');
  var sticky = document.getElementById('stickyCta');
  var hero = document.getElementById('top');

  function onScroll() {
    var y = window.pageYOffset || document.documentElement.scrollTop;
    if (header) header.classList.toggle('is-scrolled', y > 40);
    if (sticky && hero) {
      sticky.classList.toggle('is-visible', y > hero.offsetHeight * 0.92);
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* --- スマホメニューの開閉 --- */
  var burger = document.getElementById('burger');
  var nav = document.getElementById('nav');
  if (burger && nav) {
    burger.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      burger.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
      document.body.style.overflow = open ? 'hidden' : '';
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        nav.classList.remove('is-open');
        burger.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      }
    });
  }

  /* --- 最終CTAが見えている間は、追従ボタンを引っ込める --- */
  var joinSection = document.getElementById('join');
  if (sticky && joinSection && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      sticky.classList.toggle('is-hidden', entries[0].isIntersecting);
    }, { threshold: 0.12 }).observe(joinSection);
  }

  /* --- スクロールで要素をふわっと表示 --- */
  var targets = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    Array.prototype.forEach.call(targets, function (el) { el.classList.add('is-in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    Array.prototype.forEach.call(targets, function (el) { io.observe(el); });
  }

  /* --- 固定ヘッダー分を考慮したアンカースクロール --- */
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href');
    if (!id || id === '#') return;
    var target = document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    var offset = header ? header.offsetHeight + 8 : 0;
    var top = target.getBoundingClientRect().top + window.pageYOffset - offset;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: top, behavior: reduce ? 'auto' : 'smooth' });
  });

  /* --- 写真が未設置のときはプレースホルダーを表示 --- */
  Array.prototype.forEach.call(document.querySelectorAll('.photo img'), function (img) {
    function markLoaded() {
      var ph = img.parentNode.querySelector('.photo__ph');
      if (ph && img.naturalWidth > 0) ph.style.display = 'none';
    }
    if (img.complete) markLoaded();
    img.addEventListener('load', markLoaded);
  });
})();
