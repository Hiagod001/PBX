(() => {
  const host = document.getElementById('loginView');
  if (!host) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'login-background';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0, last = 0, width = 0, height = 0;
  function draw(time = 0) {
    const dark = document.documentElement.dataset.theme === 'dark';
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 1;
    const phase = reduced.matches ? 0 : time / 14000;
    for (let line = 0; line < 28; line++) {
      ctx.strokeStyle = line % 5 === 0 ? (dark ? '#823c4480' : '#9b293e35') : (dark ? '#a1a1aa20' : '#71717a22');
      ctx.beginPath();
      for (let x = -20; x <= width + 20; x += 12) {
        const y = height * .15 + line * 25 + Math.sin(x / (width || 1) * 4 + phase + line * .1) * height * .17;
        if (x === -20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  function tick(time) {
    if (time - last >= 50) { draw(time); last = time; }
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (host.classList.contains('hidden') || document.hidden) return;
    const rect = host.getBoundingClientRect();
    width = rect.width; height = rect.height;
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
    if (!reduced.matches) frame = requestAnimationFrame(tick);
  }
  new ResizeObserver(sync).observe(host);
  new MutationObserver(sync).observe(host, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', sync);
  sync();
})();
