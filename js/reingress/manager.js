const ReingressManager = (() => {

  let state = {
    eventId: null,
    round: null,
    freeParticipant: null,
    candidates: [],       // todos los perdedores elegibles
    rejected: [],         // IDs de los que rechazaron
    attemptNumber: 0,
    currentSelected: null,
    mode: 'roulette',     // 'roulette' | 'manual'
    tournament: null      // referencia al torneo actual
  };

  function getAvailable() {
    return state.candidates.filter(c => !state.rejected.includes(c.id));
  }

  async function start(tournament, freeParticipant, losers) {
    state = {
      eventId: null,
      round: tournament.current_round,
      freeParticipant,
      candidates: losers,
      rejected: [],
      attemptNumber: 0,
      currentSelected: null,
      mode: 'roulette',
      tournament
    };

    // Crear evento en Supabase
    const { data, error } = await db
      .from('reingress_events')
      .insert({
        tournament_id: tournament.id,
        round: tournament.current_round,
        free_participant_id: freeParticipant.id,
        status: 'spinning'
      })
      .select()
      .single();

    if (error) throw error;
    state.eventId = data.id;

    showIntroStep(freeParticipant, losers);
  }

  function showIntroStep(freeParticipant, losers) {
    const defaultCost = (state.tournament.entry_fee || 0) * 2;

    document.getElementById('roulette-free-player').textContent = participantDisplayName(freeParticipant);
    document.getElementById('roulette-cost-input').value = defaultCost;

    // Lista de candidatos
    const list = document.getElementById('roulette-candidates-list');
    list.innerHTML = losers.map(c => `
      <div class="list-item" id="candidate-chip-${c.id}">
        <div class="list-item-info">
          <div class="list-item-name">${participantDisplayName(c)}</div>
        </div>
      </div>`).join('');

    // Actualizar chips rechazados si volvemos al intro
    renderRejectedHistory();

    showRouletteStep('intro');
    openModal('modal-roulette');

    // Usar .onclick para reemplazar listener anterior en vez de acumular
    state.mode = 'roulette';
    const btnSpin = document.getElementById('btn-spin');
    btnSpin.onclick = () => withLoading(btnSpin, async () => {
      state.mode = 'roulette';
      doSpin();
    });
    document.getElementById('btn-pick-manual').onclick = () => showManualPick();
  }

  function doSpin() {
    const available = getAvailable();
    if (!available.length) {
      handleAllRejected();
      return;
    }

    const winnerIndex = Math.floor(Math.random() * available.length);
    state.currentSelected = available[winnerIndex];
    state.attemptNumber++;

    showRouletteStep('result');
    renderRejectedHistory();

    const reingCost = parseFloat(document.getElementById('roulette-cost-input').value) || 0;
    document.getElementById('roulette-selected-name').textContent = participantDisplayName(state.currentSelected);
    document.getElementById('roulette-cost-confirm').textContent =
      formatCurrency(reingCost, state.tournament.currency || 'MXN');
    document.getElementById('roulette-vs-player').textContent =
      participantDisplayName(state.freeParticipant);

    document.getElementById('roulette-timer').classList.remove('hidden');

    // Animación de la ruleta
    Roulette.spin(available, winnerIndex, () => {
      Roulette.startTimer(30, () => handleDecision('timeout'));
    });

    // .onclick reemplaza cualquier handler anterior — sin acumulación
    const btnAccept = document.getElementById('btn-roulette-accept');
    const btnReject = document.getElementById('btn-roulette-reject');
    btnAccept.onclick = () => withLoading(btnAccept, async () => {
      Roulette.stopTimer();
      await handleDecision('accepted');
    });
    btnReject.onclick = () => withLoading(btnReject, async () => {
      Roulette.stopTimer();
      await handleDecision('rejected');
    });
  }

  async function handleDecision(decision) {
    const selected = state.currentSelected;
    if (!selected) return;

    // Deshabilitar botones para evitar doble clic
    const btnAccept = document.getElementById('btn-roulette-accept');
    const btnReject = document.getElementById('btn-roulette-reject');
    if (btnAccept) btnAccept.onclick = null;
    if (btnReject) btnReject.onclick = null;

    // Guardar attempt en Supabase (ignorar error — no debe bloquear el flujo)
    const { error: attemptErr } = await db.from('reingress_attempts').insert({
      reingress_event_id: state.eventId,
      participant_id: selected.id,
      attempt_number: state.attemptNumber,
      decision: decision === 'timeout' ? 'rejected' : decision,
      decided_at: new Date().toISOString()
    });
    if (attemptErr) console.warn('Error guardando intento:', attemptErr.message);

    if (decision === 'accepted') {
      await handleAccepted(selected);
    } else {
      // rejected o timeout
      state.rejected.push(selected.id);
      state.currentSelected = null;

      // Marcar visualmente como rechazado
      const chip = document.getElementById(`candidate-chip-${selected.id}`);
      if (chip) chip.style.opacity = '0.4';

      const available = getAvailable();
      if (!available.length) {
        await handleAllRejected();
      } else if (state.mode === 'manual') {
        showManualPick();
      } else {
        showRouletteStep('intro');
        renderRejectedHistory();
        document.getElementById('btn-spin').onclick = () => {
          state.mode = 'roulette';
          doSpin();
        };
        document.getElementById('btn-pick-manual').onclick = () => showManualPick();
      }
    }
  }

  async function handleAccepted(acceptedParticipant) {
    const tournament = state.tournament;
    const reingCost = Math.round(parseFloat(document.getElementById('roulette-cost-input').value) || 0);

    // Crear partido especial
    const { data: match, error: matchError } = await db
      .from('matches')
      .insert({
        tournament_id: tournament.id,
        round: state.round,
        match_number: 999,
        participant1_id: state.freeParticipant.id,
        participant2_id: acceptedParticipant.id,
        match_type: 'reingress_match',
        status: 'pending'
      })
      .select()
      .single();

    if (matchError) throw matchError;

    // Cerrar evento
    await db.from('reingress_events').update({
      status: 'accepted',
      accepted_participant_id: acceptedParticipant.id,
      reingress_amount: reingCost,
      resulting_match_id: match.id,
      resolved_at: new Date().toISOString()
    }).eq('id', state.eventId);

    // Marcar participante como reingresado
    await db.from('tournament_participants')
      .update({ status: 'reingressed', reingress_paid: true })
      .eq('id', acceptedParticipant.id);

    // Registrar transacción
    await db.from('prize_pool_transactions').insert({
      tournament_id: tournament.id,
      participant_id: acceptedParticipant.id,
      transaction_type: 'reingress',
      amount: reingCost,
      description: `Reingreso ronda ${state.round}: ${participantDisplayName(acceptedParticipant)}`,
      reingress_event_id: state.eventId
    });

    // Recalcular bote desde DB para evitar race condition
    const newPool = await Prize.updatePrizePool(tournament.id);

    // Mostrar paso de éxito
    document.getElementById('roulette-accepted-name').textContent = participantDisplayName(acceptedParticipant);
    document.getElementById('roulette-accepted-amount').textContent = formatCurrency(reingCost, tournament.currency);
    document.getElementById('roulette-new-prize').textContent = formatCurrency(newPool, tournament.currency);
    showRouletteStep('accepted');

    const btnDone = document.getElementById('btn-roulette-done');
    btnDone.onclick = () => withLoading(btnDone, async () => {
      closeModal('modal-roulette');
      await TournamentPage.reload();
    });
  }

  async function handleAllRejected() {
    const tournament = state.tournament;

    await db.from('reingress_events').update({
      status: 'all_rejected',
      resolved_at: new Date().toISOString()
    }).eq('id', state.eventId);

    // El jugador libre avanza con bye
    await db.from('matches').insert({
      tournament_id: tournament.id,
      round: state.round,
      match_number: 998,
      participant1_id: state.freeParticipant.id,
      participant2_id: null,
      match_type: 'bye',
      winner_id: state.freeParticipant.id,
      loser_id: null,
      status: 'completed',
      completed_at: new Date().toISOString()
    });

    // Mostrar paso all-rejected
    document.getElementById('roulette-bye-player').textContent = participantDisplayName(state.freeParticipant);
    document.getElementById('roulette-all-rejected-list').innerHTML = state.rejected.map(id => {
      const p = state.candidates.find(c => c.id === id);
      return `<div class="text-muted" style="font-size:0.875rem;">❌ ${p ? participantDisplayName(p) : '—'}</div>`;
    }).join('');

    showRouletteStep('all-rejected');

    const btnByeDone = document.getElementById('btn-roulette-bye-done');
    btnByeDone.onclick = () => withLoading(btnByeDone, async () => {
      closeModal('modal-roulette');
      await TournamentPage.reload();
    });
  }

  function showManualPick() {
    const available = getAvailable();
    const list = document.getElementById('roulette-manual-list');
    list.innerHTML = available.map(c => `
      <div class="list-item" style="cursor:pointer;" onclick="ReingressManager._pickManual('${c.id}')">
        <div class="list-item-info">
          <div class="list-item-name">${participantDisplayName(c)}</div>
        </div>
        <span style="color:var(--color-text-muted); font-size:0.75rem;">Seleccionar →</span>
      </div>`).join('');

    state.mode = 'manual';
    showRouletteStep('manual');

    document.getElementById('btn-manual-back').onclick = () => {
      state.mode = 'roulette';
      showRouletteStep('intro');
      renderRejectedHistory();
      const btnSpinBack = document.getElementById('btn-spin');
      btnSpinBack.onclick = () => withLoading(btnSpinBack, async () => {
        state.mode = 'roulette';
        doSpin();
      });
      document.getElementById('btn-pick-manual').onclick = () => showManualPick();
    };
  }

  function pickManual(participantId) {
    const available = getAvailable();
    const selected = available.find(c => c.id === participantId);
    if (!selected) return;

    state.currentSelected = selected;
    state.attemptNumber++;

    const reingCost = Math.round(parseFloat(document.getElementById('roulette-cost-input').value) || 0);
    document.getElementById('roulette-selected-name').textContent = participantDisplayName(selected);
    document.getElementById('roulette-cost-confirm').textContent =
      formatCurrency(reingCost, state.tournament.currency || 'MXN');
    document.getElementById('roulette-vs-player').textContent = participantDisplayName(state.freeParticipant);

    renderRejectedHistory();
    showRouletteStep('result');

    // Sin animación ni timer en modo manual
    document.getElementById('roulette-timer').classList.add('hidden');

    const btnA = document.getElementById('btn-roulette-accept');
    const btnR = document.getElementById('btn-roulette-reject');
    btnA.onclick = () => withLoading(btnA, () => handleDecision('accepted'));
    btnR.onclick = () => withLoading(btnR, () => handleDecision('rejected'));
  }

  function renderRejectedHistory() {
    const historyDiv = document.getElementById('roulette-rejected-history');
    const listDiv = document.getElementById('roulette-rejected-list');
    if (!historyDiv || !listDiv) return;

    if (!state.rejected.length) {
      historyDiv.classList.add('hidden');
      return;
    }

    historyDiv.classList.remove('hidden');
    listDiv.innerHTML = `<div class="roulette-candidates-chips">` +
      state.rejected.map(id => {
        const p = state.candidates.find(c => c.id === id);
        return `<span class="roulette-candidate-chip rejected">❌ ${p ? participantDisplayName(p) : '—'}</span>`;
      }).join('') +
      '</div>';
  }

  function showRouletteStep(step) {
    ['intro','result','accepted','all-rejected','manual'].forEach(s => {
      const el = document.getElementById(`roulette-step-${s}`);
      if (el) el.classList.add('hidden');
    });
    const active = document.getElementById(`roulette-step-${step}`);
    if (active) active.classList.remove('hidden');
  }

  return { start, _pickManual: pickManual };
})();
