// Deshabilita un botón mientras ejecuta una función async.
// Evita doble click y múltiples disparos accidentales.
async function withLoading(btn, fn) {
  if (btn.disabled) return;
  const original = btn.textContent;
  btn.disabled = true;
  btn.style.opacity = '0.6';
  try {
    await fn();
  } finally {
    btn.disabled = false;
    btn.style.opacity = '';
    btn.textContent = original;
  }
}

function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'none';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
    toast.style.transition = '200ms ease';
    setTimeout(() => toast.remove(), 200);
  }, duration);
}
