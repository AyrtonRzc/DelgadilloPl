const ReingressManager = (() => {

  let state = {
    eventId: null,
    round: null,
    freeParticipant: null,
    candidates: [],       // todos los perdedores elegibles
    rejected: [],         // IDs de los que rechazaron
    attemptNumber: 0,
    currentSelected: null
  };

  function getAvailable() {
    return state.candidates.filter(c => !state.rejected.includes(c.id));
  }

  function pickRandom(available) {
    return available[Math.floor(Math.random() * available.length)];
  }

  async function start(tournament, freeParticipant, losers) {
    state = {
      eventId: null,
      round: tournament.current_round,
      freeParticipant,
      candidates: losers,
      rejected: [],
      attemptNumber: 0,
      currentSelected: null
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

    showIntroStep(tournament, freeParticipant, losers);
  }

  function showIntroStep(tournament, freeParticipant, losers) {
    const currency = tournament.currency || 'MXN';
    const reingCost = (tournament.entry_fee || 0) * 2;

    document.getElementById('roulette-free-player').textContent = participantDisplayName(freeParticipant);
    document.getElementById('roulette-cost').textContent = formatCurrency(reingCost, currency);

    // Lista de candidatos
    const list = document.getElementById('roulette-candidates-list');
    list.innerHTML = losers.map(c => `
      <div class="list-item" id="candidate-chip-${c.id}">
        <div class="list-item-info">
          <div class="list-item-name">${participantDisplayName(c)}</div>
        </div>
      </div>`).join('');

    // Mostrar paso intro
    showRouletteStep('intro');
    openModal('modal-roulette');

    document.getElementById('btn-spin').onclick = () => doSpin(tournament);
  }

  function doSpin(tournament) {
    const available = getAvailable();
    if (!available.length) {
      handleAllRejected(tournament);
      return;
    }

    const winnerIndex = Math.floor(Math.random() * available.length);
    state.currentSelected = available[winnerIndex];
    state.attemptNumber++;

    showRouletteStep('result');

    // Renderizar candidatos rechazados
    renderRejectedHistory();

    // Nombre del seleccionado
    document.getElementById('roulette-selected-name').textContent = participantDisplayName(state.currentSelected);
    document.getElementById('roulette-cost-confirm').textContent =
      formatCurrency((tournament.entry_fee || 0) * 2, tournament.currency || 'MXN');
    document.getElementById('roulette-vs-player').textContent =
      participantDisplayName(state.freeParticipant);

    // Animación de la ruleta
    Roulette.spin(available, winnerIndex, () => {
      // Iniciar timer de 30s
      document.getElementById('roulette-timer').classList.remove('hidden');
      Roulette.startTimer(30, () => handleDecision('timeout', tournament));
    });

    // Botones de decisión
    document.getElementById('btn-roulette-accept').onclick = () => {
      Roulette.stopTimer();
      handleDecision('accepted', tournament);
    };
    document.getElementById('btn-roulette-reject').onclick = () => {
      Roulette.stopTimer();
      handleDecision('rejected', tournament);
    };
  }

  async function handleDecision(decision, tournament) {
    const selected = state.currentSelected;
    if (!selected) return;

    // Guardar attempt en Supabase
    await db.from('reingress_attempts').insert({
      reingress_event_id: state.eventId,
      participant_id: selected.id,
      attempt_number: state.attemptNumber,
      decision: decision === 'timeout' ? 'rejected' : decision,
      decided_at: new Date().toISOString()
    });

    if (decision === 'accepted') {
      await handleAccepted(tournament, selected);
    } else {
      // rejected o timeout
      state.rejected.push(selected.id);
      // Marcar visualmente como rechazado
      const chip = document.getElementById(`candidate-chip-${selected.id}`);
      if (chip) chip.style.opacity = '0.4';

      const available = getAvailable();
      if (!available.length) {
        await handleAllRejected(tournament);
      } else {
        // Volver al paso de intro para girar de nuevo
        showRouletteStep('intro');
        renderRejectedHistory();
        document.getElementById('btn-spin').onclick = () => doSpin(tournament);
      }
    }
  }

  async function handleAccepted(tournament, acceptedParticipant) {
    const reingCost = (tournament.entry_fee || 0) * 2;

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

    // Actualizar bote
    const newPool = (tournament.prize_pool || 0) + reingCost;
    await db.from('tournaments').update({ prize_pool: newPool }).eq('id', tournament.id);

    // Mostrar paso de éxito
    document.getElementById('roulette-accepted-name').textContent = participantDisplayName(acceptedParticipant);
    document.getElementById('roulette-accepted-amount').textContent = formatCurrency(reingCost, tournament.currency);
    document.getElementById('roulette-new-prize').textContent = formatCurrency(newPool, tournament.currency);
    showRouletteStep('accepted');

    document.getElementById('btn-roulette-done').onclick = async () => {
      closeModal('modal-roulette');
      await TournamentPage.reload();
    };
  }

  async function handleAllRejected(tournament) {
    // Cerrar evento
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
      return `<div class="text-muted" style="font-size:0.875rem;">❌ ${p ? participantDisplayName(p) : id}</div>`;
    }).join('');

    showRouletteStep('all-rejected');

    document.getElementById('btn-roulette-bye-done').onclick = async () => {
      closeModal('modal-roulette');
      await TournamentPage.reload();
    };
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
        return `<span class="roulette-candidate-chip rejected">❌ ${p ? participantDisplayName(p) : id}</span>`;
      }).join('') +
      '</div>';
  }

  function showRouletteStep(step) {
    ['intro','result','accepted','all-rejected'].forEach(s => {
      const el = document.getElementById(`roulette-step-${s}`);
      if (el) el.classList.add('hidden');
    });
    const active = document.getElementById(`roulette-step-${step}`);
    if (active) active.classList.remove('hidden');
  }

  return { start };
})();
