// Módulo de estadísticas por organización

const Stats = (() => {

  // Estado del módulo — guardado para abrir detalle sin re-fetch
  let _data        = null;
  let _playerStats = [];
  let _players     = [];

  // ── QUERIES ──────────────────────────────────────────

  async function loadData(orgId) {
    const { data: tournaments, error } = await db
      .from('tournaments')
      .select('id, name, status, prize_pool, created_at, winner_participant_id, entry_fee, game_modes(name)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });

    if (error || !tournaments?.length) return null;

    const ids = tournaments.map(t => t.id);

    const [
      { data: participants },
      { data: matches },
      { data: transactions }
    ] = await Promise.all([
      db.from('tournament_participants')
        .select('id, tournament_id, player1_id, player2_id, display_name, status')
        .in('tournament_id', ids),
      db.from('matches')
        .select('id, tournament_id, round, winner_id, loser_id, status, match_type')
        .in('tournament_id', ids)
        .eq('status', 'completed'),
      db.from('prize_pool_transactions')
        .select('id, tournament_id, participant_id, transaction_type, amount')
        .in('tournament_id', ids)
    ]);

    return {
      tournaments,
      participants: participants || [],
      matches:      matches      || [],
      transactions: transactions || []
    };
  }

  // ── HELPERS ──────────────────────────────────────────

  function resolveParticipantName(participantId, participants, players) {
    const part = participants.find(p => p.id === participantId);
    if (!part) return '?';
    if (part.display_name) return part.display_name;
    const pl = players.find(p => p.id === part.player1_id);
    return pl?.nickname || pl?.name || '?';
  }

  // ── CÓMPUTOS ─────────────────────────────────────────

  function computePlayerStats(players, { tournaments, participants, matches, transactions }) {
    const realMatches = matches.filter(m => m.match_type !== 'bye');

    return players.map(player => {
      const myParts = participants.filter(p =>
        p.player1_id === player.id || p.player2_id === player.id
      );
      const myIds = new Set(myParts.map(p => p.id));

      const played = tournaments.filter(t =>
        t.status !== 'setup' && myParts.some(p => p.tournament_id === t.id)
      ).length;

      const wins = tournaments.filter(t =>
        t.winner_participant_id && myIds.has(t.winner_participant_id)
      ).length;

      const matchWins   = realMatches.filter(m => m.winner_id && myIds.has(m.winner_id)).length;
      const matchLosses = realMatches.filter(m => m.loser_id  && myIds.has(m.loser_id)).length;
      const total       = matchWins + matchLosses;
      const winRate     = total > 0 ? Math.round(matchWins / total * 100) : null;

      const totalEarnings = transactions
        .filter(tx => tx.transaction_type === 'payout' && myIds.has(tx.participant_id))
        .reduce((sum, tx) => sum + tx.amount, 0);

      const reingresses = transactions
        .filter(tx => tx.transaction_type === 'reentry' && myIds.has(tx.participant_id))
        .length;

      return { player, played, wins, matchWins, matchLosses, winRate, totalEarnings, reingresses };
    })
    .filter(s => s.played > 0)
    .sort((a, b) =>
      b.wins - a.wins ||
      (b.winRate ?? -1) - (a.winRate ?? -1) ||
      b.played - a.played
    );
  }

  function computeOrgStats({ tournaments, transactions }) {
    const finished   = tournaments.filter(t => t.status === 'finished').length;
    const active     = tournaments.filter(t => t.status === 'active').length;
    const totalMoney = transactions
      .filter(tx => tx.transaction_type === 'entry' || tx.transaction_type === 'reentry')
      .reduce((sum, tx) => sum + tx.amount, 0);
    return { total: tournaments.length, finished, active, totalMoney };
  }

  // Rivales: con cuántos se enfrentó y W/L contra cada uno
  function computeRivals(s) {
    const { participants, matches } = _data;
    const myParts = participants.filter(p =>
      p.player1_id === s.player.id || p.player2_id === s.player.id
    );
    const myIds = new Set(myParts.map(p => p.id));

    const myMatches = matches.filter(m =>
      m.match_type !== 'bye' && (myIds.has(m.winner_id) || myIds.has(m.loser_id))
    );

    const rivalMap = {};
    for (const m of myMatches) {
      const iWon       = myIds.has(m.winner_id);
      const oppId      = iWon ? m.loser_id : m.winner_id;
      const oppPart    = participants.find(p => p.id === oppId);
      if (!oppPart) continue;

      const key      = oppPart.player1_id || oppId;
      const oppName  = resolveParticipantName(oppId, participants, _players);

      if (!rivalMap[key]) rivalMap[key] = { name: oppName, wins: 0, losses: 0 };
      if (iWon) rivalMap[key].wins++;
      else      rivalMap[key].losses++;
    }

    return Object.values(rivalMap)
      .sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses));
  }

  // Historial partido a partido agrupado por torneo
  function computeMatchHistory(s) {
    const { tournaments, participants, matches } = _data;
    const myParts = participants.filter(p =>
      p.player1_id === s.player.id || p.player2_id === s.player.id
    );
    const myIds = new Set(myParts.map(p => p.id));

    const myMatches = matches.filter(m =>
      m.match_type !== 'bye' && (myIds.has(m.winner_id) || myIds.has(m.loser_id))
    );

    const byTournament = {};
    for (const m of myMatches) {
      if (!byTournament[m.tournament_id]) byTournament[m.tournament_id] = [];
      byTournament[m.tournament_id].push(m);
    }

    return tournaments
      .filter(t => byTournament[t.id])
      .map(t => ({
        tournament: t,
        isChampion: myParts.some(p => p.id === t.winner_participant_id),
        matches: (byTournament[t.id] || [])
          .sort((a, b) => a.round - b.round)
          .map(m => {
            const iWon     = myIds.has(m.winner_id);
            const oppId    = iWon ? m.loser_id : m.winner_id;
            const oppName  = resolveParticipantName(oppId, participants, _players);
            return { round: m.round, won: iWon, opponentName: oppName };
          })
      }));
  }

  // ── RENDER PRINCIPAL ─────────────────────────────────

  function pName(s) {
    return s.player.nickname
      ? `<span class="stats-nickname">"${s.player.nickname}"</span>`
      : `<span>${s.player.name}</span>`;
  }

  function renderSummary(orgStats, playerStats) {
    const mostActive = [...playerStats].sort((a, b) => b.played - a.played)[0];
    const mostWins   = playerStats.find(s => s.wins > 0);
    const hlName     = s => s.player.nickname ? `"${s.player.nickname}"` : s.player.name;

    return `
      <div class="stats-section">
        <div class="stats-section-title">RESUMEN</div>
        <div class="stats-grid-4">
          <div class="stat-card">
            <div class="stat-card-value">${orgStats.total}</div>
            <div class="stat-card-label">Torneos</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-value">${orgStats.finished}</div>
            <div class="stat-card-label">Finalizados</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-value ${orgStats.active ? 'stat-active' : ''}">${orgStats.active || '—'}</div>
            <div class="stat-card-label">En curso</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-value stat-card-value--sm">${orgStats.totalMoney > 0 ? formatCurrency(orgStats.totalMoney) : '—'}</div>
            <div class="stat-card-label">Total gestionado</div>
          </div>
        </div>
        ${mostActive || mostWins ? `
          <div class="stats-highlights">
            ${mostActive ? `
              <div class="stats-highlight">
                <div class="stats-hl-label">Más activo</div>
                <div class="stats-hl-name">${hlName(mostActive)}</div>
                <div class="stats-hl-sub">${mostActive.played} ${mostActive.played === 1 ? 'torneo' : 'torneos'}</div>
              </div>` : ''}
            ${mostWins ? `
              <div class="stats-highlight stats-highlight--gold">
                <div class="stats-hl-label">Más campeón</div>
                <div class="stats-hl-name">${hlName(mostWins)}</div>
                <div class="stats-hl-sub">${'🏆'.repeat(Math.min(mostWins.wins, 5))} × ${mostWins.wins}</div>
              </div>` : ''}
          </div>` : ''}
      </div>`;
  }

  function renderRanking(playerStats) {
    if (!playerStats.length) return '';
    const medal = i => ['🥇','🥈','🥉'][i] ?? (i + 1);

    return `
      <div class="stats-section">
        <div class="stats-section-title">RANKING — toca un jugador para ver su detalle</div>
        <div class="stats-table" id="stats-ranking-table">
          <div class="stats-table-head">
            <span></span>
            <span>Jugador</span>
            <span title="Torneos jugados">J</span>
            <span title="Campeonatos">🏆</span>
            <span title="Win rate en partidos">W%</span>
          </div>
          ${playerStats.map((s, i) => `
            <div class="stats-table-row stats-table-row--clickable ${i === 0 && s.wins > 0 ? 'stats-table-row--top' : ''}"
                 data-player-idx="${i}">
              <span class="stats-pos">${medal(i)}</span>
              <span class="stats-name-cell">
                <span class="stats-name-main">${pName(s)}</span>
                ${(s.matchWins + s.matchLosses) > 0
                  ? `<span class="stats-name-sub">${s.matchWins}V ${s.matchLosses}D${s.reingresses > 0 ? ` · ${s.reingresses}R` : ''}</span>`
                  : ''}
              </span>
              <span class="stats-num">${s.played}</span>
              <span class="stats-num ${s.wins > 0 ? 'stats-num--gold' : ''}">${s.wins}</span>
              <span class="stats-num">${s.winRate !== null ? s.winRate + '%' : '—'}</span>
            </div>`).join('')}
        </div>
      </div>`;
  }

  function renderHistory(tournaments, participants, transactions, players) {
    const finished = tournaments.filter(t => t.status === 'finished');
    if (!finished.length) return '';

    return `
      <div class="stats-section">
        <div class="stats-section-title">HISTORIAL DE TORNEOS</div>
        <div class="list">
          ${finished.map(t => {
            const tParts = participants.filter(p => p.tournament_id === t.id);
            const bote   = transactions
              .filter(tx => tx.tournament_id === t.id &&
                (tx.transaction_type === 'entry' || tx.transaction_type === 'reentry'))
              .reduce((sum, tx) => sum + tx.amount, 0);

            const winner = tParts.find(p => p.id === t.winner_participant_id);
            let winnerName = winner?.display_name;
            if (!winnerName && winner?.player1_id) {
              const pl = players.find(p => p.id === winner.player1_id);
              winnerName = pl?.nickname || pl?.name;
            }
            winnerName = winnerName || '?';

            return `
              <div class="list-item">
                <div class="list-item-info">
                  <div class="list-item-name">${t.name}</div>
                  <div class="list-item-sub">
                    🏆 ${winnerName} · ${tParts.length} participantes${bote > 0 ? ` · ${formatCurrency(bote)}` : ''}
                  </div>
                </div>
                <span class="stats-date">${formatDate(t.created_at)}</span>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  // ── DETALLE DE JUGADOR ────────────────────────────────

  function openPlayerDetail(idx) {
    const s       = _playerStats[idx];
    if (!s) return;

    const rivals  = computeRivals(s);
    const history = computeMatchHistory(s);
    const pl      = s.player;
    const initials = avatarInitials(pl.name);
    const color    = avatarColor(pl.name);

    const content = document.getElementById('player-detail-content');
    if (!content) return;

    content.innerHTML = `
      <!-- Header jugador -->
      <div class="pd-header">
        <div class="avatar pd-avatar" style="background:${color};">${initials}</div>
        <div>
          <div class="pd-name">${pl.name}</div>
          ${pl.nickname ? `<div class="pd-nickname">"${pl.nickname}"</div>` : ''}
        </div>
      </div>

      <!-- Quick stats -->
      <div class="stats-grid-4" style="margin-bottom:1rem;">
        <div class="stat-card">
          <div class="stat-card-value">${s.played}</div>
          <div class="stat-card-label">Torneos</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value ${s.wins > 0 ? 'text-gold' : ''}">${s.wins}</div>
          <div class="stat-card-label">Títulos</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value">${s.matchWins}</div>
          <div class="stat-card-label">Victorias</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-value stat-card-value--sm">${s.winRate !== null ? s.winRate + '%' : '—'}</div>
          <div class="stat-card-label">Win rate</div>
        </div>
      </div>

      <!-- Ganancias -->
      ${s.totalEarnings > 0 ? `
        <div class="pd-earnings">
          <div class="pd-earnings-amount">${formatCurrency(s.totalEarnings)}</div>
          <div class="pd-earnings-label">Total ganado en premios</div>
        </div>` : ''}

      <!-- Rivales -->
      ${rivals.length ? `
        <div class="pd-section-title">RIVALES</div>
        <div class="list" style="margin-bottom:1.25rem;">
          ${rivals.map(r => {
            const total = r.wins + r.losses;
            const wr    = Math.round(r.wins / total * 100);
            return `
              <div class="list-item">
                <div class="list-item-info">
                  <div class="list-item-name">${r.name}</div>
                  <div class="list-item-sub">${total} ${total === 1 ? 'enfrentamiento' : 'enfrentamientos'} · ${wr}% victorias</div>
                </div>
                <div class="pd-rival-score">
                  <span class="pd-rival-w">${r.wins}V</span>
                  <span class="pd-rival-sep">·</span>
                  <span class="pd-rival-l">${r.losses}D</span>
                </div>
              </div>`;
          }).join('')}
        </div>` : ''}

      <!-- Historial por torneo -->
      ${history.length ? `
        <div class="pd-section-title">HISTORIAL</div>
        ${history.map(h => `
          <div class="pd-tournament-block">
            <div class="pd-tournament-header">
              <span class="pd-tournament-name">${h.tournament.name}</span>
              ${h.isChampion ? '<span class="pd-champion-badge">🏆 CAMPEÓN</span>' : ''}
            </div>
            ${h.matches.map(m => `
              <div class="pd-match-row">
                <span class="pd-match-round">R${m.round}</span>
                <span class="pd-match-vs">vs <strong>${m.opponentName}</strong></span>
                <span class="pd-match-result ${m.won ? 'pd-match-result--win' : 'pd-match-result--loss'}">${m.won ? 'GANÓ' : 'PERDIÓ'}</span>
              </div>`).join('')}
          </div>`).join('')}` : ''}
    `;

    openModal('modal-player-detail');
  }

  // ── ENTRADA PÚBLICA ───────────────────────────────────

  function attachRankingClick() {
    document.getElementById('stats-ranking-table')?.addEventListener('click', e => {
      const row = e.target.closest('[data-player-idx]');
      if (row) openPlayerDetail(parseInt(row.dataset.playerIdx));
    });
  }

  async function render() {
    const { currentOrg, players } = Store.get();
    if (!currentOrg) return;

    const container = document.getElementById('tab-stats');
    if (!container) return;
    container.innerHTML = `<div class="stats-loading">Cargando stats...</div>`;

    try {
      const data = await loadData(currentOrg.id);

      if (!data) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📊</div>
            <div class="empty-state-title">SIN DATOS AÚN</div>
            <div class="empty-state-desc">Las stats aparecerán cuando se jueguen torneos</div>
          </div>`;
        return;
      }

      _data        = data;
      _players     = players;
      _playerStats = computePlayerStats(players, data);
      const orgStats = computeOrgStats(data);

      container.innerHTML =
        renderSummary(orgStats, _playerStats) +
        renderRanking(_playerStats) +
        renderHistory(data.tournaments, data.participants, data.transactions, players);

      attachRankingClick();

    } catch (e) {
      console.error('Error cargando stats:', e);
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <div class="empty-state-title">ERROR AL CARGAR</div>
          <div class="empty-state-desc">${e.message}</div>
        </div>`;
    }
  }

  return { render };
})();
