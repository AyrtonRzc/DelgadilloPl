const TournamentsList = (() => {

  async function createTournament({ name, gameModeId, modeType, venueId, entryFee, currency }) {
    const org = Store.get().currentOrg;
    const user = Auth.currentUser();
    if (!org || !user) throw new Error('Sin organización o sesión');

    name = name.trim();
    if (!name) throw new Error('El nombre es requerido');
    if (!gameModeId) throw new Error('Selecciona un modo de juego');

    const payload = {
      org_id: org.id,
      name,
      game_mode_id: gameModeId,
      mode_type: modeType || 'single',
      venue_id: venueId || null,
      entry_fee: parseFloat(entryFee) || 0,
      currency: currency || 'MXN',
      created_by: user.id,
      status: 'setup'
    };

    const { data, error } = await db
      .from('tournaments')
      .insert(payload)
      .select('*, venues(name), game_modes(name)')
      .single();

    if (error) throw error;

    await Org.loadTournaments(org.id);
    return data;
  }

  function renderTournaments() {
    const container = document.getElementById('tournaments-list');
    if (!container) return;
    const { tournaments } = Store.get();

    if (!tournaments.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🏆</div>
          <div class="empty-state-title">Sin torneos aún</div>
          <div class="empty-state-desc">Crea el primero con el botón de arriba</div>
        </div>`;
      return;
    }

    container.innerHTML = tournaments.map(t => {
      const statusLabel = { setup: 'Configurando', active: 'En curso', finished: 'Finalizado' }[t.status] || t.status;
      const statusClass = { setup: 'badge-status-setup', active: 'badge-status-active', finished: 'badge-status-finished' }[t.status];
      const venue = t.venues?.name ? `📍 ${t.venues.name}` : '';
      const mode = t.game_modes?.name || '';
      return `
        <a href="tournament.html?id=${t.id}" style="display:block; text-decoration:none;">
          <div class="list-item" style="flex-direction:column; align-items:flex-start; gap:0.5rem;">
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
              <div class="list-item-name">${t.name}</div>
              <span class="badge ${statusClass}">${statusLabel}</span>
            </div>
            <div style="display:flex; gap:0.75rem; font-size:0.75rem; color:var(--color-text-muted);">
              ${mode ? `<span>🎱 ${mode}</span>` : ''}
              ${venue ? `<span>${venue}</span>` : ''}
              ${t.entry_fee > 0 ? `<span>💰 ${formatCurrency(t.prize_pool, t.currency)}</span>` : ''}
            </div>
            <div style="font-size:0.75rem; color:var(--color-text-dim);">${formatDate(t.created_at)}</div>
          </div>
        </a>`;
    }).join('');
  }

  function renderActiveTournamentBanner() {
    const { tournaments } = Store.get();
    const active = tournaments.find(t => t.status === 'active');
    const banner = document.getElementById('active-tournament-banner');
    if (!banner) return;

    if (active) {
      document.getElementById('active-tournament-name').textContent = active.name;
      document.getElementById('active-tournament-round').textContent = `Ronda ${active.current_round}`;
      document.getElementById('active-tournament-prize').textContent = formatCurrency(active.prize_pool, active.currency);
      document.getElementById('btn-go-active-tournament').href = `tournament.html?id=${active.id}`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  function populateGameModeSelect() {
    const sel = document.getElementById('t-game-mode');
    if (!sel) return;
    const { gameModes } = Store.get();
    sel.innerHTML = gameModes.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  }

  function populateVenueSelect() {
    const sel = document.getElementById('t-venue');
    if (!sel) return;
    const { venues } = Store.get();
    sel.innerHTML = `<option value="">Sin lugar especificado</option>` +
      venues.map(v => `<option value="${v.id}">${v.name}</option>`).join('');
  }

  function initEvents() {
    document.getElementById('btn-new-tournament')?.addEventListener('click', () => {
      populateGameModeSelect();
      populateVenueSelect();
      document.getElementById('t-name').value = '';
      document.getElementById('t-entry-fee').value = '';
      document.getElementById('tournament-error').classList.add('hidden');
      openModal('modal-new-tournament');
    });

    document.getElementById('btn-confirm-tournament')?.addEventListener('click', async () => {
      const errorEl = document.getElementById('tournament-error');
      errorEl.classList.add('hidden');
      try {
        const t = await createTournament({
          name: document.getElementById('t-name').value,
          gameModeId: document.getElementById('t-game-mode').value,
          modeType: document.getElementById('t-mode-type').value,
          venueId: document.getElementById('t-venue').value,
          entryFee: document.getElementById('t-entry-fee').value,
          currency: document.getElementById('t-currency').value
        });
        closeModal('modal-new-tournament');
        renderTournaments();
        renderActiveTournamentBanner();
        showToast('Torneo creado', 'success');
        // Ir al torneo directamente
        window.location.href = `tournament.html?id=${t.id}`;
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.classList.remove('hidden');
      }
    });
  }

  return { createTournament, renderTournaments, renderActiveTournamentBanner, initEvents };
})();
