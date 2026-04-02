// Controlador de public.html — sin login, acceso por token
// Reutiliza Match, Bracket, Prize y ReingressManager

const TournamentPage = (() => {

  let state = {
    tournament: null,
    participants: [],
    matches: [],
    transactions: [],
    freeParticipant: null,
    viewToken: null,
    operatorToken: null,
    isOperator: false
  };

  function getParams() {
    const p = new URLSearchParams(window.location.search);
    return { viewToken: p.get('t'), operatorToken: p.get('op') };
  }

  async function loadTournament(viewToken) {
    const { data, error } = await db
      .from('tournaments')
      .select('*, venues(name), game_modes(name)')
      .eq('view_token', viewToken)
      .single();
    if (error || !data) return null;
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
    if (error) return [];
    return data || [];
  }

  async function loadTransactions(tournamentId) {
    const { data, error } = await db
      .from('prize_pool_transactions')
      .select('*, tournament_participants(display_name, player1:players!tournament_participants_player1_id_fkey(name, nickname))')
      .eq('tournament_id', tournamentId)
      .order('created_at');
    if (error) return [];
    return data || [];
  }

  async function reload() {
    if (!state.viewToken) return;

    const t = await loadTournament(state.viewToken);
    if (!t) return;

    state.tournament   = t;
    state.participants = await loadParticipants(t.id);
    state.matches      = await Bracket.loadMatches(t.id);
    state.transactions = await loadTransactions(t.id);

    render();
  }

  function render() {
    const t = state.tournament;
    if (!t) return;

    document.getElementById('tournament-title').textContent = t.name;
    document.getElementById('info-mode').textContent =
      `${t.game_modes?.name || ''} · ${t.mode_type === 'doubles' ? 'Parejas' : 'Individual'}`;
    document.getElementById('info-venue').textContent = t.venues?.name || '';

    Bracket.render(state.matches, 'bracket-container');
    renderCurrentRoundSection();
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

    const freeSection    = document.getElementById('free-player-section');
    const advanceSection = document.getElementById('advance-round-section');
    const finishSection  = document.getElementById('finish-tournament-section');

    freeSection.classList.add('hidden');
    advanceSection.classList.add('hidden');
    finishSection.classList.add('hidden');

    state.freeParticipant = null;

    if (t.status === 'finished') {
      Match.renderCurrentRound(state.matches, round, null, { canEdit: false });
      return;
    }

    const hasReingressMatch = roundMatches.some(m => m.match_type === 'reingress_match');
    const hasBye = state.matches.some(m => m.round === round && m.match_type === 'bye');

    if (!hasReingressMatch && !hasBye) {
      const oddMatch = roundMatches.find(m => m.participant2_id === null && m.match_type === 'normal');
      if (oddMatch) {
        state.freeParticipant = state.participants.find(p => p.id === oddMatch.participant1_id);
      }
    }

    Match.renderCurrentRound(state.matches, round, state.freeParticipant?.id, {
      canEdit: state.isOperator
    });

    if (state.isOperator) {
      const normalMatches = roundMatches.filter(m => m.match_type === 'normal' && m.match_number !== 0);
      const allNormalComplete = normalMatches.length > 0 && normalMatches.every(m => m.status === 'completed');
      const losersExist = normalMatches.some(m => m.loser_id);

      if (state.freeParticipant && !hasReingressMatch && !hasBye && allNormalComplete && losersExist) {
        document.getElementById('free-player-name').textContent =
          participantDisplayName(state.freeParticipant);
        freeSection.classList.remove('hidden');
      }

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
  }

  function getRoundWinners(round) {
    const roundMatches = state.matches.filter(m => m.round === round && m.status === 'completed');
    const winnerIds = roundMatches.map(m => m.winner_id).filter(Boolean);
    return state.participants.filter(p => winnerIds.includes(p.id));
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

    for (const p of state.participants) {
      if (p.status === 'reingressed') {
        await db.from('tournament_participants')
          .update({ status: 'active' }).eq('id', p.id);
      }
    }

    const { matches, freeParticipant } = Bracket.generateNextRound(roundWinners, nextRound, t.id);

    if (freeParticipant) {
      matches.push({
        tournament_id: t.id, round: nextRound, match_number: 0,
        participant1_id: freeParticipant.id, participant2_id: null,
        match_type: 'normal', status: 'pending'
      });
    }

    await Bracket.saveMatches(matches);
    await db.from('tournaments').update({ current_round: nextRound }).eq('id', t.id);

    await reload();
    showToast(`Ronda ${nextRound} iniciada`, 'success');
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
    if (!state.freeParticipant) return;

    const round = state.tournament.current_round;
    const roundMatches = state.matches.filter(m =>
      m.round === round && m.status === 'completed' && m.loser_id
    );
    const loserIds = roundMatches.map(m => m.loser_id);
    const losers = state.participants.filter(p => loserIds.includes(p.id));

    if (!losers.length) {
      showToast('No hay perdedores elegibles para la ruleta aún', 'error');
      return;
    }

    ReingressManager.start(state.tournament, state.freeParticipant, losers);
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
  }

  async function init() {
    const { viewToken, operatorToken } = getParams();

    if (!viewToken) {
      document.getElementById('screen-loading').classList.add('hidden');
      document.getElementById('screen-not-found').classList.remove('hidden');
      return;
    }

    state.viewToken     = viewToken;
    state.operatorToken = operatorToken;
    state.isOperator    = !!operatorToken;

    initTabs();
    initEvents();

    const t = await loadTournament(viewToken);

    if (!t) {
      document.getElementById('screen-loading').classList.add('hidden');
      document.getElementById('screen-not-found').classList.remove('hidden');
      return;
    }

    // Verificar token de operador
    if (state.isOperator && t.operator_token !== operatorToken) {
      state.isOperator = false;
      state.operatorToken = null;
      showToast('Token de operador inválido — modo solo lectura', 'error');
    }

    if (state.isOperator) {
      document.getElementById('operator-badge').classList.remove('hidden');
    }

    state.tournament   = t;
    state.participants = await loadParticipants(t.id);
    state.matches      = await Bracket.loadMatches(t.id);
    state.transactions = await loadTransactions(t.id);

    document.getElementById('screen-loading').classList.add('hidden');
    document.getElementById('screen-tournament').classList.remove('hidden');

    render();
    setupRealtime(t.id);
  }

  return {
    get state() { return state; },
    reload,
    advanceRound,
    finishTournament,
    openFinishModal,
    init
  };
})();

document.addEventListener('DOMContentLoaded', () => TournamentPage.init());
