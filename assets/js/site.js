/* Small page behaviors: solid top bar after scrolling, light/dark switch. */
(function () {
  var bar = document.querySelector('.topbar');
  function onScroll() { bar.classList.toggle('is-solid', window.scrollY > 60); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  var btn = document.querySelector('.theme-toggle');
  btn.addEventListener('click', function () {
    var root = document.documentElement;
    var isDark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    var next = isDark ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (e) {}
    if (window.refreshContourColors) window.refreshContourColors();
  });
})();
