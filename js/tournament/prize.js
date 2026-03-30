const Prize = (() => {

  async function loadTransactions(tournamentId) {
    const { data, error } = await db
      .from('prize_pool_transactions')
      .select('*, tournament_participants(display_name, player1:players!tournament_participants_player1_id_fkey(name, nickname))')
      .eq('tournament_id', tournamentId)
      .order('created_at');
    if (error) throw error;
    return data || [];
  }

  async function addEntryTransaction(tournamentId, participantId, amount, currency) {
    const participant = TournamentPage.state.participants.find(p => p.id === participantId);
    const name = participantDisplayName(participant);

    await db.from('prize_pool_transactions').insert({
      tournament_id: tournamentId,
      participant_id: participantId,
      transaction_type: 'entry',
      amount,
      description: `Entrada: ${name}`
    });

    await db.from('tournament_participants').update({ entry_paid: true }).eq('id', participantId);
    await updatePrizePool(tournamentId);
  }

  async function updatePrizePool(tournamentId) {
    const txs = await loadTransactions(tournamentId);
    const total = txs
      .filter(t => t.transaction_type !== 'payout')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    await db.from('tournaments').update({ prize_pool: total }).eq('id', tournamentId);
    return total;
  }

  function render(tournament, transactions) {
    const currency = tournament.currency || 'MXN';

    // Bote total
    const total = transactions
      .filter(t => t.transaction_type !== 'payout')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const entries = transactions.filter(t => t.transaction_type === 'entry');
    const reingresses = transactions.filter(t => t.transaction_type === 'reingress');

    // Bote total header
    const boteTotal = document.getElementById('bote-total');
    if (boteTotal) boteTotal.textContent = formatCurrency(total, currency);

    // Info bar
    const infoPrize = document.getElementById('info-prize');
    if (infoPrize) infoPrize.textContent = formatCurrency(total, currency);

    // Banner activo en index
    const activePrize = document.getElementById('active-tournament-prize');
    if (activePrize) activePrize.textContent = formatCurrency(total, currency);

    // Desglose
    const breakdown = document.getElementById('bote-breakdown');
    if (breakdown) {
      const entryTotal = entries.reduce((s, t) => s + t.amount, 0);
      const reingTotal = reingresses.reduce((s, t) => s + t.amount, 0);
      breakdown.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:0.5rem; font-size:0.875rem;">
          <div style="display:flex; justify-content:space-between;">
            <span class="text-muted">Entradas (${entries.length} × ${formatCurrency(tournament.entry_fee, currency)})</span>
            <span>${formatCurrency(entryTotal, currency)}</span>
          </div>
          ${reingTotal > 0 ? `
          <div style="display:flex; justify-content:space-between;">
            <span class="text-muted">Reingresos (${reingresses.length})</span>
            <span class="text-accent">${formatCurrency(reingTotal, currency)}</span>
          </div>` : ''}
          <hr class="divider" style="margin:0.25rem 0;">
          <div style="display:flex; justify-content:space-between; font-weight:700;">
            <span>Total</span>
            <span class="text-accent">${formatCurrency(total, currency)}</span>
          </div>
        </div>`;
    }

    // Historial
    const txList = document.getElementById('bote-transactions');
    if (txList) {
      if (!transactions.length) {
        txList.innerHTML = '<div class="text-muted text-center" style="padding:1rem;">Sin movimientos aún</div>';
      } else {
        txList.innerHTML = transactions.map(t => {
          const name = t.tournament_participants
            ? participantDisplayName(t.tournament_participants)
            : '—';
          const icon = t.transaction_type === 'entry' ? '💵'
            : t.transaction_type === 'reingress' ? '🎡'
            : '🏆';
          const typeLabel = t.transaction_type === 'entry' ? 'Entrada'
            : t.transaction_type === 'reingress' ? 'Reingreso'
            : 'Pago';
          return `
            <div class="list-item" style="gap:0.75rem;">
              <span style="font-size:1.25rem;">${icon}</span>
              <div class="list-item-info">
                <div class="list-item-name">${name}</div>
                <div class="list-item-sub">${typeLabel} · ${formatDate(t.created_at)}</div>
              </div>
              <span style="font-weight:700; color:var(--color-accent);">${formatCurrency(t.amount, currency)}</span>
            </div>`;
        }).join('');
      }
    }
  }

  return { loadTransactions, addEntryTransaction, updatePrizePool, render };
})();
