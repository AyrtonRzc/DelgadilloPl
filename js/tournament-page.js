// Controlador de tournament.html

const TournamentPage = (() => {

  let state = {
    tournament: null,
    participants: [],
    matches: [],
    transactions: [],
    freeParticipant: null,
    operatorToken: null   // null en admin — usado por Match.correctResult
  };

  function getTournamentId() {
    return new URLSearchParams(window.location.search).get('id');
  }

  async function loadTournament(id) {
    const { data, error } = await db
      .from('tournaments')
      .select('*, venues(name), game_modes(name)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  }

  async function loadParticipants(tournamentId) {
    const { data, error } = await db
      .from('tournament_participants')
      .select(`
        *,
        player1:players!tournament_participants_player1_id_fkey(id, name, nickname, teams(name,color,logo_url)),
        player2:players!tournament_participants_player2_id_fkey(id, name, nickname, teams(name,color,logo_url))
      `)
      .eq('tournament_id', tournamentId)
      .order('seed');
    if (error) throw error;
    return data || [];
  }

  async function reload() {
    const id = getTournamentId();
    if (!id) return;

    state.tournament  = await loadTournament(id);
    state.participants = await loadParticipants(id);
    state.matches     = await Bracket.loadMatches(id);
    state.transactions = await Prize.loadTransactions(id);

    render();
  }

  function render() {
    const t = state.tournament;
    if (!t) return;

    // Topbar
    document.getElementById('tournament-title').textContent = t.name;
    document.getElementById('info-mode').textContent =
      `${t.game_modes?.name || ''} · ${t.mode_type === 'doubles' ? 'Parejas' : 'Individual'}`;
    document.getElementById('info-venue').textContent = t.venues?.name || '';

    // Bracket
    Bracket.render(state.matches, 'bracket-container');

    // Ronda actual
    renderCurrentRoundSection();

    // Bote
    Prize.render(t, state.transactions);
  }

  function renderCurrentRoundSection() {
    const t = state.tournament;
    const round = t.current_round;

    const roundBall = document.getElementById('round-ball');
    if (roundBall) roundBall.textContent = round;
    document.getElementById('round-title').textContent =
      t.status === 'finished' ? 'Torneo finalizado' : `Ronda ${round}`;

    const roundMatches = state.matches.filter(m =>
      m.round === round && m.match_type !== 'bye'
    );

    // Buscar jugador libre pendiente de ruleta
    const freeSection = document.getElementById('free-player-section');
    const advanceSection = document.getElementById('advance-round-section');
    const finishSection = document.getElementById('finish-tournament-section');

    freeSection.classList.add('hidden');
    advanceSection.classList.add('hidden');
    finishSection.classList.add('hidden');

    state.freeParticipant = null;

    if (t.status === 'finished' || t.status === 'cancelled') {
      document.getElementById('round-title').textContent =
        t.status === 'cancelled' ? 'Torneo cancelado' : 'Torneo finalizado';
      Match.renderCurrentRound(state.matches, round, null);
      return;
    }

    // Detectar si hay ruleta activa pendiente (reingress_match sin completar)
    const reingresMatch = roundMatches.find(m =>
      m.match_type === 'reingress_match' && m.status !== 'completed'
    );

    // Detectar jugador libre: hay un bye en esta ronda con status completed cuyo partner es null
    const byeMatch = state.matches.find(m =>
      m.round === round && m.match_type === 'bye'
    );

    // Determinar si todos los partidos normales + reingreso están completos
    const allNormalDone = roundMatches
      .filter(m => m.match_type !== 'bye')
      .every(m => m.status === 'completed');

    // Detectar si hay impar pendiente de ruleta (no hay bye ni reingress_match aún)
    const activeParticipants = state.participants.filter(p => p.status === 'active' || p.status === 'reingressed');
    const winners = state.matches
      .filter(m => m.round === round && m.status === 'completed' && m.winner_id)
      .map(m => m.winner_id);

    // El jugador libre es aquel ganador de ronda anterior (o inicio) sin partido en ronda actual
    const participantsInRound = new Set([
      ...roundMatches.map(m => m.participant1_id),
      ...roundMatches.map(m => m.participant2_id),
      ...(byeMatch ? [byeMatch.participant1_id] : [])
    ]);

    // Si hay número impar en ronda actual y no hay bye ni reingress_match → mostrar botón ruleta
    const allRoundParticipantIds = roundMatches.reduce((acc, m) => {
      if (m.participant1_id) acc.add(m.participant1_id);
      if (m.participant2_id) acc.add(m.participant2_id);
      return acc;
    }, new Set());

    // Detectar free participant: está en esta ronda pero sin pareja
    // Solo aplica si todos los partidos normales están listos pero falta el partido de reingreso
    const hasReingressMatch = roundMatches.some(m => m.match_type === 'reingress_match');
    const hasBye = state.matches.some(m => m.round === round && m.match_type === 'bye');

    // Si el torneo acaba de iniciar la ronda y hay número impar sin bye ni reingress_match
    if (!hasReingressMatch && !hasBye) {
      // Identificar participante sin pareja buscando en los matches
      // Si (número de matches × 2) < número de participantes en ronda → hay uno libre
      const expectedParticipants = roundMatches.length * 2;
      const uniqueInRound = allRoundParticipantIds.size;
      // Si uniqueInRound == expectedParticipants y roundMatches tiene un solo jugador null
      const oddMatch = roundMatches.find(m => m.participant2_id === null && m.match_type === 'normal');
      if (oddMatch) {
        state.freeParticipant = state.participants.find(p => p.id === oddMatch.participant1_id);
      }
    }

    // Render matches de la ronda (excluye el placeholder match_number=0)
    Match.renderCurrentRound(state.matches, round, state.freeParticipant?.id, { canEdit: true });

    // Mostrar sección de jugador libre SOLO cuando todos los partidos normales están completos
    const normalMatches = roundMatches.filter(m => m.match_type === 'normal' && m.match_number !== 0);
    const allNormalComplete = normalMatches.length > 0 && normalMatches.every(m => m.status === 'completed');
    const losersExist = normalMatches.some(m => m.loser_id);

    if (state.freeParticipant && !hasReingressMatch && !hasBye && allNormalComplete && losersExist) {
      document.getElementById('free-player-name').textContent =
        participantDisplayName(state.freeParticipant);
      freeSection.classList.remove('hidden');
    }

    // Verificar si se puede avanzar ronda
    // Solo contar partidos reales (excluir placeholder match_number=0)
    const realMatches = roundMatches.filter(m => m.match_number !== 0);
    const allComplete = realMatches.length > 0 &&
      realMatches.every(m => m.status === 'completed') &&
      (hasBye || hasReingressMatch || !state.freeParticipant);

    if (allComplete) {
      const roundWinners = getRoundWinners(round);

      if (roundWinners.length === 1) {
        finishSection.classList.remove('hidden');
      } else {
        advanceSection.classList.remove('hidden');
      }
    }
  }

  function getRoundWinners(round) {
    const roundMatches = state.matches.filter(m => m.round === round && m.status === 'completed');
    const winnerIds = roundMatches.map(m => m.winner_id).filter(Boolean);
    return state.participants.filter(p => winnerIds.includes(p.id));
  }

  async function startTournament() {
    const t = state.tournament;
    if (!t) return;

    // Registrar entradas de todos los participantes si hay fee
    if (t.entry_fee > 0) {
      for (const p of state.participants) {
        if (!p.entry_paid) {
          await db.from('prize_pool_transactions').insert({
            tournament_id: t.id,
            participant_id: p.id,
            transaction_type: 'entry',
            amount: t.entry_fee,
            description: `Entrada: ${participantDisplayName(p)}`
          });
          await db.from('tournament_participants')
            .update({ entry_paid: true }).eq('id', p.id);
        }
      }
      await Prize.updatePrizePool(t.id);
    }

    // Generar primera ronda
    const { matches, freeParticipant } = Bracket.generateFirstRound(state.participants, t.id);

    // Si hay impar, agregar un match especial con participant2=null para identificarlo
    if (freeParticipant) {
      matches.push({
        tournament_id: t.id,
        round: 1,
        match_number: 0,  // 0 = jugador libre, no es partido real todavía
        participant1_id: freeParticipant.id,
        participant2_id: null,
        match_type: 'normal',  // se convertirá en reingress o bye
        status: 'pending'
      });
    }

    await Bracket.saveMatches(matches);

    // Actualizar status del torneo
    await db.from('tournaments').update({
      status: 'active',
      started_at: new Date().toISOString(),
      current_round: 1
    }).eq('id', t.id);

    await reload();
    showToast('¡Torneo iniciado!', 'success');
  }

  async function advanceRound() {
    const t = state.tournament;
    const round = t.current_round;
    const nextRound = round + 1;

    const roundWinners = getRoundWinners(round);
    if (roundWinners.length < 2) {
      showToast('Solo queda un participante, finaliza el torneo', 'error');
      return;
    }

    // Resetear participantes activos (los reingresados vuelven a activo para la siguiente ronda)
    for (const p of state.participants) {
      if (p.status === 'reingressed') {
        await db.from('tournament_participants')
          .update({ status: 'active' }).eq('id', p.id);
      }
    }

    // Generar siguiente ronda
    const { matches, freeParticipant } = Bracket.generateNextRound(roundWinners, nextRound, t.id);

    if (freeParticipant) {
      matches.push({
        tournament_id: t.id,
        round: nextRound,
        match_number: 0,
        participant1_id: freeParticipant.id,
        participant2_id: null,
        match_type: 'normal',
        status: 'pending'
      });
    }

    await Bracket.saveMatches(matches);
    await db.from('tournaments').update({ current_round: nextRound }).eq('id', t.id);

    await reload();
    showToast(`Ronda ${nextRound} iniciada`, 'success');

    // Cambiar a tab de ronda
    document.querySelector('[data-tab="ronda"]')?.click();
  }

  async function finishTournament(championId) {
    const t = state.tournament;

    await db.from('tournament_participants')
      .update({ status: 'champion' }).eq('id', championId);

    await db.from('tournaments').update({
      status: 'finished',
      winner_participant_id: championId,
      finished_at: new Date().toISOString()
    }).eq('id', t.id);

    await reload();
    showToast('🏆 ¡Torneo finalizado!', 'success');
  }

  function openFinishModal() {
    const round = state.tournament.current_round;
    const winners = getRoundWinners(round);

    const list = document.getElementById('finish-finalist-list');
    list.innerHTML = winners.map(p => `
      <button class="btn btn-accent" data-champion-id="${p.id}">
        🏆 ${participantDisplayName(p)}
      </button>
    `).join('');

    // Usar delegación de eventos — sin onclick inline con IDs en el HTML
    list.onclick = async (e) => {
      const btn = e.target.closest('[data-champion-id]');
      if (!btn) return;
      list.onclick = null;
      closeModal('modal-finish-tournament');
      await finishTournament(btn.dataset.championId);
    };

    openModal('modal-finish-tournament');
  }

  function openRouletteForCurrentRound() {
    const t = state.tournament;
    const round = t.current_round;

    // El jugador libre ya está en state.freeParticipant
    if (!state.freeParticipant) return;

    // Obtener perdedores de esta ronda
    const roundMatches = state.matches.filter(m =>
      m.round === round && m.status === 'completed' && m.loser_id
    );
    const loserIds = roundMatches.map(m => m.loser_id);
    const losers = state.participants.filter(p => loserIds.includes(p.id));

    if (!losers.length) {
      showToast('No hay perdedores elegibles para la ruleta aún', 'error');
      return;
    }

    ReingressManager.start(t, state.freeParticipant, losers);
  }

  async function addParticipant(player1Id, player2Id = null, displayName = null) {
    const t = state.tournament;
    const seed = state.participants.length + 1;

    const payload = {
      tournament_id: t.id,
      player1_id: player1Id,
      player2_id: player2Id || null,
      display_name: displayName || null,
      seed,
      status: 'active',
      entry_paid: false
    };

    const { data, error } = await db
      .from('tournament_participants')
      .insert(payload)
      .select(`
        *,
        player1:players!tournament_participants_player1_id_fkey(id, name, nickname, teams(name,color,logo_url)),
        player2:players!tournament_participants_player2_id_fkey(id, name, nickname, teams(name,color,logo_url))
      `)
      .single();

    if (error) {
      if (error.code === '23505') throw new Error('Este jugador ya está en el torneo');
      throw error;
    }

    await reload();
    return data;
  }

  function initTabs() {
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        ['bracket','ronda','bote'].forEach(t => {
          document.getElementById(`tab-${t}`)?.classList.toggle('hidden', t !== tab);
        });
      });
    });
  }

  async function ensureTokens() {
    const t = state.tournament;
    if (t.view_token && t.operator_token) return;
    // Generar tokens si faltan (torneos creados antes del trigger)
    const vt = crypto.randomUUID().replace(/-/g, '');
    const ot = crypto.randomUUID().replace(/-/g, '');
    await db.from('tournaments').update({ view_token: vt, operator_token: ot }).eq('id', t.id);
    await reload();
  }

  function openShareLinksModal() {
    const t = state.tournament;
    const base = window.location.origin +
      window.location.pathname.replace('tournament.html', 'public.html');
    const viewUrl = `${base}?t=${t.view_token}`;
    const opUrl   = `${base}?t=${t.view_token}&op=${t.operator_token}`;

    document.getElementById('share-view-url').value = viewUrl;
    document.getElementById('share-operator-url').value = opUrl;

    document.getElementById('btn-copy-view-url').onclick = () => {
      navigator.clipboard.writeText(viewUrl);
      showToast('Link de vista copiado', 'success');
    };
    document.getElementById('btn-copy-operator-url').onclick = () => {
      navigator.clipboard.writeText(opUrl);
      showToast('Link de operador copiado', 'success');
    };

    openModal('modal-share-links');
  }

  function setupRealtime(tournamentId) {
    let reloadTimer = null;
    const scheduleReload = () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => reload(), 400);
    };

    db.channel(`tournament-${tournamentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches',
          filter: `tournament_id=eq.${tournamentId}` }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments',
          filter: `id=eq.${tournamentId}` }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_participants',
          filter: `tournament_id=eq.${tournamentId}` }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prize_pool_transactions',
          filter: `tournament_id=eq.${tournamentId}` }, scheduleReload)
      .subscribe();
  }

  // ── RESETEAR RONDA ───────────────────────────────────

  function openResetModal() {
    // Usar el máximo round real en los matches, no solo current_round
    // (por si current_round quedó desincronizado con los datos reales)
    const maxRound = state.matches.length
      ? Math.max(...state.matches.map(m => m.round))
      : state.tournament.current_round;

    const sel = document.getElementById('reset-round-select');
    sel.innerHTML = '';
    for (let r = maxRound; r >= 1; r--) {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r === 1
        ? `Ronda 1 en adelante (borra todos los partidos)`
        : `Ronda ${r} en adelante (quedan rondas 1–${r - 1})`;
      sel.appendChild(opt);
    }

    closeModal('modal-admin-tools');
    openModal('modal-reset-round');
  }

  async function resetToRound(deleteFromRound) {
    const t  = state.tournament;
    const id = t.id;

    // Obtener IDs de eventos de reingreso afectados
    const { data: events } = await db.from('reingress_events')
      .select('id')
      .eq('tournament_id', id)
      .gte('round', deleteFromRound);
    const eventIds = (events || []).map(e => e.id);

    if (eventIds.length) {
      // 1. Borrar intentos de ruleta (FK → reingress_events)
      await db.from('reingress_attempts').delete().in('reingress_event_id', eventIds);

      // 2. Borrar transacciones de reingreso (FK → reingress_events)
      await db.from('prize_pool_transactions').delete().in('reingress_event_id', eventIds);

      // 3. Nullear resulting_match_id para romper la FK hacia matches
      await db.from('reingress_events')
        .update({ resulting_match_id: null })
        .eq('tournament_id', id).gte('round', deleteFromRound);

      // 4. Borrar reingress_events
      await db.from('reingress_events').delete()
        .eq('tournament_id', id).gte('round', deleteFromRound);
    }

    // 5. Borrar partidos de las rondas afectadas
    await db.from('matches').delete()
      .eq('tournament_id', id).gte('round', deleteFromRound);

    // 6. Resetear todos los participantes a 'active'
    await db.from('tournament_participants').update({ status: 'active' })
      .eq('tournament_id', id);

    // 7. Re-eliminar a quienes perdieron en las rondas que SÍ quedan
    const { data: remaining } = await db.from('matches')
      .select('loser_id')
      .eq('tournament_id', id)
      .eq('status', 'completed')
      .not('loser_id', 'is', null);

    const loserIds = [...new Set((remaining || []).map(m => m.loser_id))];
    for (const lid of loserIds) {
      await db.from('tournament_participants').update({ status: 'eliminated' }).eq('id', lid);
    }

    // 8. Recalcular bote (se borraron transacciones de reingreso)
    if (eventIds.length) await Prize.updatePrizePool(id);

    // 9. Actualizar ronda actual (mínimo 1)
    const newRound = Math.max(1, deleteFromRound - 1);
    await db.from('tournaments').update({ current_round: newRound }).eq('id', id);

    await reload();
    showToast(
      deleteFromRound === 1
        ? 'Todos los partidos borrados — ronda 1 limpia'
        : `Torneo reseteado a ronda ${newRound}`,
      'success'
    );
  }

  // ── CANCELAR TORNEO ──────────────────────────────────

  async function cancelTournament() {
    const t = state.tournament;
    await db.from('tournaments').update({ status: 'cancelled' }).eq('id', t.id);

    await reload();
    showToast('Torneo cancelado — los partidos quedan en stats', 'success');
  }

  // ── MENÚ ADMIN ───────────────────────────────────────

  function initAdminMenu() {
    document.getElementById('btn-tournament-menu')?.addEventListener('click', () => {
      openModal('modal-admin-tools');
    });

    document.getElementById('btn-tool-share')?.addEventListener('click', async function() {
      closeModal('modal-admin-tools');
      await ensureTokens();
      openShareLinksModal();
    });

    document.getElementById('btn-tool-reset')?.addEventListener('click', () => {
      openResetModal();
    });

    document.getElementById('btn-tool-cancel')?.addEventListener('click', () => {
      closeModal('modal-admin-tools');
      openModal('modal-cancel-tournament');
    });

    document.getElementById('btn-confirm-reset-round')?.addEventListener('click', function() {
      const round = parseInt(document.getElementById('reset-round-select').value);
      closeModal('modal-reset-round');
      withLoading(this, () => resetToRound(round));
    });

    document.getElementById('btn-confirm-cancel-tournament')?.addEventListener('click', function() {
      closeModal('modal-cancel-tournament');
      withLoading(this, cancelTournament);
    });
  }

  function initEvents() {
    document.getElementById('btn-start-roulette')?.addEventListener('click', function() {
      withLoading(this, openRouletteForCurrentRound);
    });
    document.getElementById('btn-advance-round')?.addEventListener('click', function() {
      withLoading(this, advanceRound);
    });
    document.getElementById('btn-finish-tournament')?.addEventListener('click', function() {
      withLoading(this, openFinishModal);
    });

    initAdminMenu();
  }

  async function init() {
    const id = getTournamentId();
    if (!id) { window.location.href = 'index.html'; return; }

    await Auth.init();
    if (!Auth.currentUser()) { window.location.href = 'index.html'; return; }

    initTabs();
    initEvents();

    try {
      await reload();
      setupRealtime(id);

      // Si está en setup, mostrar botón de iniciar
      if (state.tournament?.status === 'setup') {
        renderSetupScreen();
      }
    } catch (e) {
      console.error(e);
      showToast('Error al cargar el torneo', 'error');
    }
  }

  function renderSetupScreen() {
    // En modo setup, tab de ronda muestra el panel de configuración
    const container = document.getElementById('matches-list');
    const { participants } = state;
    const t = state.tournament;

    container.innerHTML = `
      <div class="alert alert-info" style="margin-bottom:1rem;">
        Agrega los participantes y luego inicia el torneo.
      </div>
      <div id="setup-participants-list" class="list" style="margin-bottom:1rem;">
        ${participants.length ? participants.map(p => `
          <div class="list-item">
            <div class="list-item-info">
              <div class="list-item-name">${participantDisplayName(p)}</div>
            </div>
          </div>`).join('') : '<div class="text-muted text-center" style="padding:1rem;">Sin participantes aún</div>'}
      </div>
      <button class="btn btn-ghost" id="btn-add-participant" style="margin-bottom:0.75rem;">+ Agregar participante</button>
      ${participants.length >= 2 ? `<button class="btn btn-accent" id="btn-start-tournament">🎱 Iniciar torneo (${participants.length} participantes)</button>` : ''}
    `;

    document.getElementById('btn-add-participant')?.addEventListener('click', () => {
      openAddParticipantModal();
    });

    document.getElementById('btn-start-tournament')?.addEventListener('click', function() {
      if (participants.length < 2) {
        showToast('Necesitas al menos 2 participantes', 'error');
        return;
      }
      withLoading(this, startTournament);
    });

    document.querySelector('[data-tab="ronda"]')?.click();
  }

  function openAddParticipantModal() {
    const { players, currentOrg } = Store.get();

    // Si no hay jugadores en el store, recargar
    if (!players.length) {
      showToast('Cargando directorio...', 'info');
      const org = state.tournament ? { id: state.tournament.org_id } : null;
      if (org) Org.loadPlayers(org.id).then(() => openAddParticipantModal());
      return;
    }

    const t = state.tournament;
    const usedIds = state.participants.map(p => p.player1_id);
    const available = players.filter(p => !usedIds.includes(p.id));

    if (!available.length) {
      showToast('Todos los jugadores del directorio ya están en el torneo', 'error');
      return;
    }

    // Crear modal dinámico
    const existing = document.getElementById('modal-add-participant');
    if (existing) existing.remove();

    const isDoubles = t.mode_type === 'doubles';

    const modalHtml = `
      <div class="modal-backdrop" id="modal-add-participant">
        <div class="modal">
          <div class="modal-handle"></div>
          <div class="modal-title">${isDoubles ? 'Agregar pareja' : 'Agregar jugador'}</div>
          <div class="form-group">
            <label class="form-label">Jugador ${isDoubles ? '1' : ''}</label>
            <select class="form-select" id="add-p1">
              ${available.map(p => `<option value="${p.id}">${p.name}${p.nickname ? ` "${p.nickname}"` : ''}</option>`).join('')}
            </select>
          </div>
          ${isDoubles ? `
          <div class="form-group">
            <label class="form-label">Jugador 2</label>
            <select class="form-select" id="add-p2">
              ${available.map(p => `<option value="${p.id}">${p.name}${p.nickname ? ` "${p.nickname}"` : ''}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Nombre de la pareja (opcional)</label>
            <input type="text" class="form-input" id="add-pair-name" placeholder="Los Compadres">
          </div>` : ''}
          <div id="add-participant-error" class="form-error hidden"></div>
          <button class="btn btn-primary" id="btn-confirm-add-participant">Agregar</button>
          <button class="btn btn-ghost mt-2" data-close-modal="modal-add-participant">Cancelar</button>
        </div>
      </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    document.getElementById('btn-confirm-add-participant').addEventListener('click', function() {
      const p1 = document.getElementById('add-p1').value;
      const p2 = isDoubles ? document.getElementById('add-p2').value : null;
      const pairName = isDoubles ? document.getElementById('add-pair-name')?.value.trim() : null;
      const errEl = document.getElementById('add-participant-error');
      errEl.classList.add('hidden');

      if (isDoubles && p1 === p2) {
        errEl.textContent = 'Los dos jugadores deben ser diferentes';
        errEl.classList.remove('hidden');
        return;
      }

      withLoading(this, async () => {
        try {
          await addParticipant(p1, p2, pairName || null);
          closeModal('modal-add-participant');
          renderSetupScreen();
          showToast('Participante agregado', 'success');
        } catch (e) {
          errEl.textContent = e.message;
          errEl.classList.remove('hidden');
        }
      });
    });

    openModal('modal-add-participant');
  }

  return {
    get state() { return state; },
    reload,
    startTournament,
    advanceRound,
    finishTournament,
    openFinishModal,
    openAddParticipantModal,
    init
  };
})();

document.addEventListener('DOMContentLoaded', () => TournamentPage.init());
