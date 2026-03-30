function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

// Cerrar con botones [data-close-modal]
document.addEventListener('click', e => {
  const target = e.target.closest('[data-close-modal]');
  if (target) closeModal(target.dataset.closeModal);
});

// Cerrar al tocar el backdrop (fuera del modal)
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-backdrop')) {
    e.target.classList.remove('open');
  }
});
