const Bracket = (() => {

  // Fisher-Yates shuffle
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Genera los matches de la primera ronda
  // Retorna { matches: [], freeParticipant: null }
  function generateFirstRound(participants, tournamentId) {
    const shuffled = shuffle(participants);
    const isOdd = shuffled.length % 2 !== 0;
    const paired = isOdd ? shuffled.slice(0, -1) : shuffled;
    const freeParticipant = isOdd ? shuffled[shuffled.length - 1] : null;

    const matches = [];
    for (let i = 0; i < paired.length; i += 2) {
      matches.push({
        tournament_id: tournamentId,
        round: 1,
        match_number: Math.floor(i / 2) + 1,
        participant1_id: paired[i].id,
        participant2_id: paired[i + 1].id,
        match_type: 'normal',
        status: 'pending'
      });
    }

    return { matches, freeParticipant };
  }

  // Genera matches de rondas siguientes a partir de ganadores
  function generateNextRound(winners, round, tournamentId) {
    const isOdd = winners.length % 2 !== 0;
    const paired = isOdd ? winners.slice(0, -1) : winners;
    const freeParticipant = isOdd ? winners[winners.length - 1] : null;

    const matches = [];
    for (let i = 0; i < paired.length; i += 2) {
      matches.push({
        tournament_id: tournamentId,
        round,
        match_number: Math.floor(i / 2) + 1,
        participant1_id: paired[i].id,
        participant2_id: paired[i + 1].id,
        match_type: 'normal',
        status: 'pending'
      });
    }

    return { matches, freeParticipant };
  }

  // Guarda los matches en Supabase
  async function saveMatches(matchesPayload) {
    if (!matchesPayload.length) return [];
    const { data, error } = await db
      .from('matches')
      .insert(matchesPayload)
      .select();
    if (error) throw error;
    return data;
  }

  // Carga todos los matches de un torneo
  async function loadMatches(tournamentId) {
    const { data, error } = await db
      .from('matches')
      .select(`
        *,
        participant1:tournament_participants!matches_participant1_id_fkey(
          id, display_name, player1_id, player2_id,
          player1:players!tournament_participants_player1_id_fkey(name, nickname, teams(name,color,logo_url)),
          player2:players!tournament_participants_player2_id_fkey(name, nickname, teams(name,color,logo_url))
        ),
        participant2:tournament_participants!matches_participant2_id_fkey(
          id, display_name, player1_id, player2_id,
          player1:players!tournament_participants_player1_id_fkey(name, nickname, teams(name,color,logo_url)),
          player2:players!tournament_participants_player2_id_fkey(name, nickname, teams(name,color,logo_url))
        ),
        winner:tournament_participants!matches_winner_id_fkey(id, display_name,
          player1:players!tournament_participants_player1_id_fkey(name, nickname)
        )
      `)
      .eq('tournament_id', tournamentId)
      .order('round')
      .order('match_number');
    if (error) throw error;
    return data || [];
  }

  // Renderiza el bracket visual
  function render(matches, containerId = 'bracket-container') {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!matches.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎱</div><div class="empty-state-title">Sin partidos aún</div><div class="empty-state-desc">El bracket se generará al iniciar el torneo</div></div>';
      return;
    }

    // Agrupar por ronda
    const rounds = {};
    matches.forEach(m => {
      if (!rounds[m.round]) rounds[m.round] = [];
      rounds[m.round].push(m);
    });

    const maxRound = Math.max(...Object.keys(rounds).map(Number));
    const roundLabels = ['', 'Primera ronda', 'Segunda ronda', 'Cuartos', 'Semis', 'Final'];

    let html = '<div class="bracket-wrapper"><div class="bracket">';

    Object.keys(rounds).sort((a,b) => a-b).forEach(round => {
      const r = parseInt(round);
      const label = r === maxRound ? 'Final' : (roundLabels[r] || `Ronda ${r}`);
      html += `<div class="bracket-round">
        <div class="bracket-round-title">${label}</div>`;

      rounds[round].forEach(m => {
        const p1 = m.participant1;
        const p2 = m.participant2;
        const p1Name = p1 ? participantDisplayName(p1) : '---';
        const p2Name = p2 ? participantDisplayName(p2) : (m.match_type === 'bye' ? 'BYE' : '---');
        const p1Team = p1?.player1?.teams;
        const p2Team = p2?.player1?.teams;

        const p1Class = m.winner_id === p1?.id ? 'winner' : (m.winner_id && m.winner_id !== p1?.id ? 'loser' : '');
        const p2Class = m.winner_id === p2?.id ? 'winner' : (m.winner_id && m.winner_id !== p2?.id ? 'loser' : (!p2 ? 'tbd' : ''));
        const reingClass = m.match_type === 'reingress_match' ? 'reingress' : '';
        const byeClass = m.match_type === 'bye' ? 'bye' : '';

        const p1TeamHtml = p1Team
          ? (p1Team.logo_url
            ? `<img src="${p1Team.logo_url}" style="height:14px; width:auto; object-fit:contain; flex-shrink:0;">`
            : `<span class="team-dot" style="background:${p1Team.color}"></span>`)
          : '';
        const p2TeamHtml = p2Team
          ? (p2Team.logo_url
            ? `<img src="${p2Team.logo_url}" style="height:14px; width:auto; object-fit:contain; flex-shrink:0;">`
            : `<span class="team-dot" style="background:${p2Team.color}"></span>`)
          : '';
        html += `
          <div class="bracket-match">
            <div class="bracket-participant ${p1Class} ${reingClass}">
              ${p1TeamHtml}
              <span>${p1Name}</span>
            </div>
            <div class="bracket-participant ${p2Class} ${byeClass} ${reingClass}">
              ${p2TeamHtml}
              <span>${p2Name}</span>
            </div>
          </div>`;
      });

      html += '</div>';
    });

    html += '</div></div>';
    container.innerHTML = html;
  }

  return { generateFirstRound, generateNextRound, saveMatches, loadMatches, render };
})();
