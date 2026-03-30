const Roulette = (() => {

  const COLORS = [
    '#6366f1','#f59e0b','#22c55e','#ef4444',
    '#8b5cf6','#06b6d4','#f97316','#ec4899',
    '#10b981','#3b82f6','#a855f7','#14b8a6'
  ];

  let canvas, ctx, animId, timerInterval;
  let currentAngle = 0;

  function drawWheel(candidates, angleOffset = 0) {
    if (!canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(cx, cy) - 8;
    const n = candidates.length;
    const slice = (2 * Math.PI) / n;

    ctx.clearRect(0, 0, w, h);

    candidates.forEach((c, i) => {
      const start = angleOffset + i * slice - Math.PI / 2;
      const end = start + slice;

      // Sector
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, end);
      ctx.closePath();
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fill();
      ctx.strokeStyle = '#1a1a24';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Texto
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(start + slice / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.min(14, 120 / n)}px Inter, sans-serif`;
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 4;

      const name = participantDisplayName(c).substring(0, 12);
      ctx.fillText(name, r - 12, 5);
      ctx.restore();
    });

    // Centro
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, 2 * Math.PI);
    ctx.fillStyle = '#1a1a24';
    ctx.fill();
    ctx.strokeStyle = 'var(--color-border)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function spin(candidates, winnerIndex, onDone) {
    canvas = document.getElementById('roulette-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    const n = candidates.length;
    const slice = (2 * Math.PI) / n;

    // Ángulo destino: el centro del sector ganador debe quedar en la parte superior (12 o'clock)
    // La flecha apunta hacia arriba (0 radianes = top)
    const targetSectorCenter = winnerIndex * slice;
    const fullRotations = 5 * 2 * Math.PI; // 5 vueltas completas
    const targetAngle = fullRotations + (2 * Math.PI - targetSectorCenter) - slice / 2;

    let start = null;
    const duration = 4000; // ms

    function easeOut(t) {
      return 1 - Math.pow(1 - t, 4);
    }

    function frame(ts) {
      if (!start) start = ts;
      const elapsed = ts - start;
      const progress = Math.min(elapsed / duration, 1);
      const angle = easeOut(progress) * targetAngle;

      drawWheel(candidates, angle);
      currentAngle = angle;

      if (progress < 1) {
        animId = requestAnimationFrame(frame);
      } else {
        drawWheel(candidates, targetAngle);
        if (navigator.vibrate) navigator.vibrate(200);
        setTimeout(() => onDone(candidates[winnerIndex]), 300);
      }
    }

    cancelAnimationFrame(animId);
    drawWheel(candidates, 0);
    animId = requestAnimationFrame(frame);
  }

  function startTimer(seconds, onTimeout) {
    clearInterval(timerInterval);
    let remaining = seconds;
    const countEl = document.getElementById('roulette-timer-count');
    const barFill = document.querySelector('.roulette-timer-bar-fill');

    if (countEl) countEl.textContent = remaining;
    if (barFill) barFill.style.width = '100%';

    timerInterval = setInterval(() => {
      remaining--;
      if (countEl) countEl.textContent = remaining;
      if (barFill) barFill.style.width = `${(remaining / seconds) * 100}%`;

      if (remaining <= 0) {
        clearInterval(timerInterval);
        onTimeout();
      }
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
  }

  return { drawWheel, spin, startTimer, stopTimer };
})();
