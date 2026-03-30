const Match = (() => {

  async function recordResult(matchId, winnerId) {
    const match = TournamentPage.state.matches.find(m => m.id === matchId);
    if (!match) throw new Error('Partido no encontrado');

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

    // Marcar participante perdedor como eliminado
    await db
      .from('tournament_participants')
      .update({ status: 'eliminated' })
      .eq('id', loserId);

    showToast('Resultado registrado', 'success');
    await TournamentPage.reload();
  }

  function renderCurrentRound(matches, currentRound, freeParticipantId) {
    const container = document.getElementById('matches-list');
    if (!container) return;

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
                ? `<img src="${p1Team.logo_url}" style="height:16px; width:auto; object-fit:contain;">`
                : `<span class="team-badge-sm" style="background:${p1Team.color}">${p1Team.name}</span>`) : ''}
              ${p1Name}
            </div>
            <div class="match-vs">VS</div>
            <div class="match-card-player ${p2WinClass}">
              ${p2Team ? (p2Team.logo_url
                ? `<img src="${p2Team.logo_url}" style="height:16px; width:auto; object-fit:contain;">`
                : `<span class="team-badge-sm" style="background:${p2Team.color}">${p2Team.name}</span>`) : ''}
              ${p2Name}
            </div>
          </div>
          ${!isCompleted && p1 && p2 ? `
            <div class="match-card-action">
              <button class="btn btn-ghost btn-sm" onclick="Match.openResultModal('${m.id}')">
                Registrar resultado
              </button>
            </div>` : ''}
          ${isCompleted ? `
            <div class="alert alert-success" style="padding:0.5rem 0.75rem; font-size:0.8125rem;">
              ✅ Ganó: <strong>${m.winner_id === p1?.id ? p1Name : p2Name}</strong>
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

    document.getElementById('btn-winner-1').onclick = async () => {
      closeModal('modal-match-result');
      await recordResult(matchId, match.participant1_id);
    };
    document.getElementById('btn-winner-2').onclick = async () => {
      closeModal('modal-match-result');
      await recordResult(matchId, match.participant2_id);
    };

    openModal('modal-match-result');
  }

  return { recordResult, renderCurrentRound, openResultModal };
})();
