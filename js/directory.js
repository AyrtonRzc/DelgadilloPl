const Directory = (() => {

  // ── PLAYERS ──────────────────────────────────────────

  async function savePlayer({ id, name, nickname, teamId }) {
    const org = Store.get().currentOrg;
    if (!org) throw new Error('Sin organización');

    name = name.trim();
    if (!name) throw new Error('El nombre es requerido');

    const payload = {
      org_id: org.id,
      name,
      nickname: nickname?.trim() || null,
      team_id: teamId || null
    };

    let result;
    if (id) {
      result = await db.from('players').update(payload).eq('id', id).select('*, teams(id,name,color)').single();
    } else {
      result = await db.from('players').insert(payload).select('*, teams(id,name,color)').single();
    }

    if (result.error) {
      if (result.error.code === '23505') throw new Error('Ya existe un jugador con ese nombre');
      throw result.error;
    }

    await Org.loadPlayers(org.id);
    return result.data;
  }

  async function deletePlayer(id) {
    const { error } = await db.from('players').delete().eq('id', id);
    if (error) throw error;
    const org = Store.get().currentOrg;
    await Org.loadPlayers(org.id);
  }

  // ── TEAMS ─────────────────────────────────────────────

  async function saveTeam({ id, name, color }) {
    const org = Store.get().currentOrg;
    if (!org) throw new Error('Sin organización');

    name = name.trim();
    if (!name) throw new Error('El nombre es requerido');

    const payload = { org_id: org.id, name, color: color || '#6366f1' };

    let result;
    if (id) {
      result = await db.from('teams').update(payload).eq('id', id).select().single();
    } else {
      result = await db.from('teams').insert(payload).select().single();
    }

    if (result.error) {
      if (result.error.code === '23505') throw new Error('Ya existe un team con ese nombre');
      throw result.error;
    }

    await Org.loadTeams(org.id);
    return result.data;
  }

  async function deleteTeam(id) {
    const { error } = await db.from('teams').delete().eq('id', id);
    if (error) throw error;
    const org = Store.get().currentOrg;
    await Org.loadTeams(org.id);
  }

  // ── RENDER ────────────────────────────────────────────

  function renderPlayers() {
    const container = document.getElementById('players-list');
    if (!container) return;
    const { players } = Store.get();

    if (!players.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">👤</div>
          <div class="empty-state-title">Sin jugadores</div>
          <div class="empty-state-desc">Agrega jugadores al directorio</div>
        </div>`;
      return;
    }

    container.innerHTML = players.map(p => {
      const teamLogo = p.teams?.logo_url
        ? `<img src="${p.teams.logo_url}" style="height:18px; width:auto; object-fit:contain; vertical-align:middle; margin-right:2px;">`
        : '';
      const teamName = p.teams ? p.teams.name : '';
      const teamInfo = p.teams
        ? `<span style="display:inline-flex; align-items:center; gap:3px; font-size:0.75rem; color:var(--color-text-muted);">${teamLogo}${teamName}</span>`
        : '';
      const color = avatarColor(p.name);
      const initials = avatarInitials(p.name);
      return `
        <div class="list-item">
          <div class="avatar" style="background:${color}">${initials}</div>
          <div class="list-item-info">
            <div class="list-item-name">${p.name}${p.nickname ? ` <span style="color:var(--color-text-muted); font-weight:400; font-size:0.875rem;">"${p.nickname}"</span>` : ''}</div>
            <div class="list-item-sub">${teamInfo}</div>
          </div>
          <button class="btn-icon btn-sm" onclick="Directory.openEditPlayer('${p.id}')">✏️</button>
        </div>`;
    }).join('');
  }

  function renderTeams() {
    const container = document.getElementById('teams-list');
    if (!container) return;
    const { teams } = Store.get();

    if (!teams.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🏳️</div>
          <div class="empty-state-title">Sin teams</div>
          <div class="empty-state-desc">Crea teams para identificar a los jugadores</div>
        </div>`;
      return;
    }

    container.innerHTML = teams.map(t => {
      const avatar = t.logo_url
        ? `<img src="${t.logo_url}" style="width:36px; height:36px; border-radius:50%; object-fit:contain; flex-shrink:0; background:${t.color};">`
        : `<div style="width:36px; height:36px; border-radius:50%; background:${t.color}; flex-shrink:0;"></div>`;
      return `
        <div class="list-item">
          ${avatar}
          <div class="list-item-info">
            <div class="list-item-name">${t.name}</div>
          </div>
          <button class="btn-icon btn-sm" onclick="Directory.openEditTeam('${t.id}')">✏️</button>
        </div>`;
    }).join('');
  }

  function populateTeamSelect(selectId, selectedId = null) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const { teams } = Store.get();
    sel.innerHTML = `<option value="">Sin team</option>` +
      teams.map(t => `<option value="${t.id}" ${t.id === selectedId ? 'selected' : ''}>${t.name}</option>`).join('');
  }

  function openNewPlayer() {
    document.getElementById('edit-player-id').value = '';
    document.getElementById('player-name').value = '';
    document.getElementById('player-nickname').value = '';
    document.getElementById('modal-player-title').textContent = 'Nuevo jugador';
    document.getElementById('player-error').classList.add('hidden');
    populateTeamSelect('player-team');
    openModal('modal-new-player');
  }

  function openEditPlayer(id) {
    const { players } = Store.get();
    const p = players.find(x => x.id === id);
    if (!p) return;
    document.getElementById('edit-player-id').value = p.id;
    document.getElementById('player-name').value = p.name;
    document.getElementById('player-nickname').value = p.nickname || '';
    document.getElementById('modal-player-title').textContent = 'Editar jugador';
    document.getElementById('player-error').classList.add('hidden');
    populateTeamSelect('player-team', p.team_id);
    openModal('modal-new-player');
  }

  function openNewTeam() {
    document.getElementById('edit-team-id').value = '';
    document.getElementById('team-name').value = '';
    document.getElementById('team-color').value = '#6366f1';
    document.getElementById('modal-team-title').textContent = 'Nuevo team';
    document.getElementById('team-error').classList.add('hidden');
    openModal('modal-new-team');
  }

  function openEditTeam(id) {
    const { teams } = Store.get();
    const t = teams.find(x => x.id === id);
    if (!t) return;
    document.getElementById('edit-team-id').value = t.id;
    document.getElementById('team-name').value = t.name;
    document.getElementById('team-color').value = t.color || '#6366f1';
    document.getElementById('modal-team-title').textContent = 'Editar team';
    document.getElementById('team-error').classList.add('hidden');
    openModal('modal-new-team');
  }

  function initEvents() {
    document.getElementById('btn-new-player')?.addEventListener('click', openNewPlayer);
    document.getElementById('btn-new-team')?.addEventListener('click', openNewTeam);

    document.getElementById('btn-confirm-player')?.addEventListener('click', async () => {
      const id = document.getElementById('edit-player-id').value;
      const name = document.getElementById('player-name').value;
      const nickname = document.getElementById('player-nickname').value;
      const teamId = document.getElementById('player-team').value;
      const errorEl = document.getElementById('player-error');
      errorEl.classList.add('hidden');

      try {
        await savePlayer({ id: id || null, name, nickname, teamId });
        closeModal('modal-new-player');
        renderPlayers();
        showToast('Jugador guardado', 'success');
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.classList.remove('hidden');
      }
    });

    document.getElementById('btn-confirm-team')?.addEventListener('click', async () => {
      const id = document.getElementById('edit-team-id').value;
      const name = document.getElementById('team-name').value;
      const color = document.getElementById('team-color').value;
      const errorEl = document.getElementById('team-error');
      errorEl.classList.add('hidden');

      try {
        await saveTeam({ id: id || null, name, color });
        closeModal('modal-new-team');
        renderTeams();
        showToast('Team guardado', 'success');
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.classList.remove('hidden');
      }
    });

    // Subtabs directorio
    document.querySelectorAll('[data-subtab]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-subtab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.subtab;
        document.getElementById('subtab-jugadores').classList.toggle('hidden', tab !== 'jugadores');
        document.getElementById('subtab-teams').classList.toggle('hidden', tab !== 'teams');
      });
    });
  }

  return {
    savePlayer,
    deletePlayer,
    saveTeam,
    deleteTeam,
    renderPlayers,
    renderTeams,
    populateTeamSelect,
    openNewPlayer,
    openEditPlayer,
    openNewTeam,
    openEditTeam,
    initEvents
  };
})();
