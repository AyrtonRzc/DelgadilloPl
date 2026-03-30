const Match = (() => {

  async function recordResult(matchId, winnerId) {
    // Fetch fresh match data to avoid stale state
    const { data: match, error: fetchErr } = await db
      .from('matches').select('*').eq('id', matchId).single();
    if (fetchErr || !match) throw new Error('Partido no encontrado');

    // Validate winnerId belongs to one of the two participants
    const validIds = [match.participant1_id, match.participant2_id].filter(Boolean);
    if (!validIds.includes(winnerId)) throw new Error('Ganador inválido');

    const loserId = match.participant1_id === winnerId
      ? match.participant2_id
      : match.participant1_id;

    const { error } = await db
      .from('matches')
      .update({
        winner_id: winnerId,
        loser_id: loserId,
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', matchId);

    if (error) throw error;

    if (loserId) {
      await db
        .from('tournament_participants')
        .update({ status: 'eliminated' })
        .eq('id', loserId);
    }

    await TournamentPage.reload();
    showToast('Resultado registrado', 'success');
  }

  // options: { canEdit: true }
  // canEdit=true → muestra botones de registrar/corregir resultado
  function renderCurrentRound(matches, currentRound, freeParticipantId, options = {}) {
    const container = document.getElementById('matches-list');
    if (!container) return;

    const { canEdit = false } = options;

    const roundMatches = matches.filter(m =>
      m.round === currentRound && m.match_type !== 'bye' && m.match_number !== 0
    );

    if (!roundMatches.length) {
      container.innerHTML = '<div class="text-muted text-center" style="padding:2rem;">Sin partidos en esta ronda</div>';
      return;
    }

    container.innerHTML = roundMatches.map(m => {
      const p1 = m.participant1;
      const p2 = m.participant2;
      const p1Name = p1 ? participantDisplayName(p1) : '???';
      const p2Name = p2 ? participantDisplayName(p2) : '???';
      const p1Team = p1?.player1?.teams;
      const p2Team = p2?.player1?.teams;
      const isCompleted = m.status === 'completed';
      const isReingress = m.match_type === 'reingress_match';

      const p1WinClass = m.winner_id === p1?.id ? 'winner-highlight' : '';
      const p2WinClass = m.winner_id === p2?.id ? 'winner-highlight' : '';

      return `
        <div class="match-card">
          ${isReingress ? '<span class="match-type-badge match-type-reingress">🎡 Partido de reingreso</span>' : ''}
          <div class="match-card-header">Partido ${m.match_number}</div>
          <div class="match-card-players">
            <div class="match-card-player ${p1WinClass}">
              ${p1Team ? (p1Team.logo_url
                ? `<img src="${p1Team.logo_url}" style="height:32px; width:auto; max-width:56px; object-fit:contain;">`
                : `<span class="team-badge-sm" style="background:${p1Team.color}">${p1Team.name}</span>`) : ''}
              <span>${p1Name}</span>
            </div>
            <div class="match-vs">VS</div>
            <div class="match-card-player ${p2WinClass}">
              ${p2Team ? (p2Team.logo_url
                ? `<img src="${p2Team.logo_url}" style="height:32px; width:auto; max-width:56px; object-fit:contain;">`
                : `<span class="team-badge-sm" style="background:${p2Team.color}">${p2Team.name}</span>`) : ''}
              <span>${p2Name}</span>
            </div>
          </div>
          ${canEdit && !isCompleted && p1 && p2 ? `
            <div class="match-card-action">
              <button class="btn btn-ghost btn-sm" onclick="Match.openResultModal('${m.id}')">
                Registrar resultado
              </button>
            </div>` : ''}
          ${isCompleted ? `
            <div class="alert alert-success" style="padding:0.5rem 0.75rem; font-size:0.8125rem; display:flex; justify-content:space-between; align-items:center;">
              <span>✅ Ganó: <strong>${m.winner_id === p1?.id ? p1Name : p2Name}</strong></span>
              ${canEdit ? `<button class="btn btn-ghost btn-sm" style="font-size:0.7rem; padding:0.2rem 0.5rem; color:var(--color-text-dim);" onclick="Match.openCorrectResultModal('${m.id}')">Corregir</button>` : ''}
            </div>` : ''}
        </div>`;
    }).join('');
  }

  function openResultModal(matchId) {
    const match = TournamentPage.state.matches.find(m => m.id === matchId);
    if (!match) return;

    const p1Name = participantDisplayName(match.participant1);
    const p2Name = participantDisplayName(match.participant2);

    document.getElementById('match-result-info').textContent = `Ronda ${match.round} · Partido ${match.match_number}`;
    document.getElementById('btn-winner-1').textContent = `🏆 ${p1Name}`;
    document.getElementById('btn-winner-2').textContent = `🏆 ${p2Name}`;

    const btn1 = document.getElementById('btn-winner-1');
    const btn2 = document.getElementById('btn-winner-2');

    btn1.onclick = () => withLoading(btn1, async () => {
      closeModal('modal-match-result');
      await recordResult(matchId, match.participant1_id);
    });
    btn2.onclick = () => withLoading(btn2, async () => {
      closeModal('modal-match-result');
      await recordResult(matchId, match.participant2_id);
    });

    openModal('modal-match-result');
  }

  function canCorrectMatch(matchId, allMatches) {
    const match = allMatches.find(m => m.id === matchId);
    if (!match) return { ok: false, reason: 'Partido no encontrado' };
    if (match.status !== 'completed') return { ok: false, reason: 'El partido no está completado' };

    // Bloquear si el ganador ya jugó en ronda posterior
    const winnerInNextRound = allMatches.some(m =>
      m.round > match.round &&
      (m.participant1_id === match.winner_id || m.participant2_id === match.winner_id)
    );
    if (winnerInNextRound) {
      return { ok: false, reason: 'El ganador ya jugó en rondas posteriores. No se puede corregir.' };
    }

    // Bloquear si el perdedor está involucrado en una ruleta de reingreso
    const loserInReingress = allMatches.some(m =>
      m.round === match.round &&
      m.match_type === 'reingress_match' &&
      (m.participant1_id === match.loser_id || m.participant2_id === match.loser_id)
    );
    if (loserInReingress) {
      return { ok: false, reason: 'El perdedor participó en una ruleta de reingreso. No se puede corregir.' };
    }

    return { ok: true };
  }

  function openCorrectResultModal(matchId) {
    const allMatches = TournamentPage.state.matches;
    const match = allMatches.find(m => m.id === matchId);
    if (!match) return;

    const check = canCorrectMatch(matchId, allMatches);
    if (!check.ok) {
      showToast(check.reason, 'error');
      return;
    }

    const p1Name = participantDisplayName(match.participant1);
    const p2Name = participantDisplayName(match.participant2);
    const winnerName = match.winner_id === match.participant1_id ? p1Name : p2Name;
    const loserName = match.winner_id === match.participant1_id ? p2Name : p1Name;

    document.getElementById('correct-result-info').innerHTML =
      `Ganador registrado: <strong style="color:var(--color-gold);">${winnerName}</strong><br>
       Perdedor registrado: <strong style="color:var(--color-text-muted);">${loserName}</strong>`;

    const btn = document.getElementById('btn-confirm-correct-result');
    btn.onclick = () => withLoading(btn, async () => {
      await correctResult(matchId);
      closeModal('modal-correct-result');
    });

    openModal('modal-correct-result');
  }

  async function correctResult(matchId) {
    // TournamentPage existe tanto en tournament.html (admin) como en public.html (operador)
    const operatorToken = TournamentPage.state.operatorToken || null;

    const { data, error } = await db.rpc('correct_match_result', {
      p_match_id: matchId,
      p_operator_token: operatorToken
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    await TournamentPage.reload();
    showToast('Resultado corregido', 'success');
  }

  return { recordResult, renderCurrentRound, openResultModal, openCorrectResultModal, canCorrectMatch, correctResult };
})();
