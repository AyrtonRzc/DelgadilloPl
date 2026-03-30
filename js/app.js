// Punto de entrada principal — index.html

const App = (() => {

  function showScreen(id) {
    ['screen-auth','screen-main'].forEach(s => {
      document.getElementById(s)?.classList.add('hidden');
    });
    document.getElementById(id)?.classList.remove('hidden');
  }

  function showOrgScreen(hasOrg) {
    document.getElementById('screen-no-org')?.classList.toggle('hidden', hasOrg);
    document.getElementById('screen-org')?.classList.toggle('hidden', !hasOrg);
  }

  function renderOrgSelector() {
    const { orgs, currentOrg } = Store.get();
    const sel = document.getElementById('select-org');
    if (!sel) return;

    sel.innerHTML = orgs.map(o =>
      `<option value="${o.id}" ${o.id === currentOrg?.id ? 'selected' : ''}>${o.name}</option>`
    ).join('');
  }

  async function loadAndRender(org) {
    await Org.selectOrg(org);
    renderOrgSelector();
    Directory.renderPlayers();
    Directory.renderTeams();
    Directory.renderVenues();
    TournamentsList.renderTournaments();
    TournamentsList.renderActiveTournamentBanner();
    showOrgScreen(true);
  }

  async function onSignedIn() {
    showScreen('screen-main');
    const orgs = await Org.loadUserOrgs();

    if (!orgs.length) {
      showOrgScreen(false);
      return;
    }

    // Recuperar última org seleccionada o usar la primera
    const saved = Store.load();
    const lastOrg = orgs.find(o => o.id === saved.currentOrgId) || orgs[0];
    Store.set({ currentOrg: lastOrg });

    await loadAndRender(lastOrg);
  }

  function onSignedOut() {
    showScreen('screen-auth');
  }

  function initTabs() {
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const parent = btn.closest('.tabs');
        parent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const tab = btn.dataset.tab;

        // Tabs principales
        const tabMap = {
          torneos: 'tab-torneos',
          directorio: 'tab-directorio',
          miembros: 'tab-miembros',
          stats: 'tab-stats',
          login: 'tab-login',
          register: 'tab-register'
        };

        Object.values(tabMap).forEach(id => {
          document.getElementById(id)?.classList.add('hidden');
        });
        if (tabMap[tab]) document.getElementById(tabMap[tab])?.classList.remove('hidden');

        // Cargar datos al entrar a la pestaña Miembros
        if (tab === 'miembros') renderMembersList();
      });
    });
  }

  function initAuthForms() {
    // Login
    document.getElementById('btn-login')?.addEventListener('click', async () => {
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      const errorEl = document.getElementById('login-error');
      errorEl.classList.add('hidden');

      if (!username || !password) {
        errorEl.textContent = 'Completa todos los campos';
        errorEl.classList.remove('hidden');
        return;
      }

      const btn = document.getElementById('btn-login');
      btn.disabled = true;
      btn.textContent = 'Entrando...';

      try {
        await Auth.login(username, password);
        // onSignedIn se llama automáticamente por onAuthStateChange
      } catch (e) {
        errorEl.textContent = 'Usuario o contraseña incorrectos';
        errorEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = 'ENTRAR';
      }
    });

    // Register
    document.getElementById('btn-register')?.addEventListener('click', async () => {
      const name = document.getElementById('register-name').value.trim();
      const username = document.getElementById('register-username').value.trim();
      const password = document.getElementById('register-password').value;
      const errorEl = document.getElementById('register-error');
      errorEl.classList.add('hidden');

      if (!name || !username || !password) {
        errorEl.textContent = 'Completa todos los campos';
        errorEl.classList.remove('hidden');
        return;
      }
      if (password.length < 6) {
        errorEl.textContent = 'La contraseña debe tener al menos 6 caracteres';
        errorEl.classList.remove('hidden');
        return;
      }

      const btn = document.getElementById('btn-register');
      btn.disabled = true;
      btn.textContent = 'Creando cuenta...';

      try {
        await Auth.register(username, password, name);
        showToast(`Cuenta creada. Bienvenido, ${name}!`, 'success', 4000);
        // Hacer login automático después del registro
        await Auth.login(username, password);
      } catch (e) {
        errorEl.textContent = e.message || 'Error al registrarse';
        errorEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'CREAR CUENTA';
      }
    });

    // Logout
    document.getElementById('btn-logout')?.addEventListener('click', async () => {
      await Auth.logout();
    });
  }

  // ── MIEMBROS ─────────────────────────────────────────

  function initMemberTabs() {
    document.querySelectorAll('[data-membertab]').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('[data-membertab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.membertab;
        document.getElementById('membertab-crear').classList.toggle('hidden', tab !== 'crear');
        document.getElementById('membertab-codigos').classList.toggle('hidden', tab !== 'codigos');
        document.getElementById('membertab-lista').classList.toggle('hidden', tab !== 'lista');
        if (tab === 'codigos') renderInviteCodes();
        if (tab === 'lista') renderMembersList();
      };
    });
  }

  async function renderInviteCodes() {
    const container = document.getElementById('invite-codes-list');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center; color:var(--color-text-dim); padding:1rem;">Cargando...</div>';
    const codes = await Org.loadInviteCodes();
    if (!codes.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔑</div>
          <div class="empty-state-title">Sin códigos activos</div>
          <div class="empty-state-desc">Genera uno con el botón de arriba</div>
        </div>`;
      return;
    }
    container.innerHTML = codes.map(c => `
      <div class="list-item">
        <div class="list-item-info">
          <div class="list-item-name" style="font-family:var(--font-display); letter-spacing:0.1em;">${c.code}</div>
          <div class="list-item-sub">Rol: ${c.role} · ${c.used_count || 0} uso(s)</div>
        </div>
        <button class="btn-icon btn-sm" onclick="navigator.clipboard.writeText('${c.code}').then(()=>showToast('Código copiado','success'))" title="Copiar">📋</button>
        <button class="btn-icon btn-sm" onclick="App.deleteCode('${c.id}')" title="Eliminar">🗑️</button>
      </div>`).join('');
  }

  async function deleteCode(id) {
    try {
      await Org.deleteInviteCode(id);
      await renderInviteCodes();
      showToast('Código eliminado', 'success');
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function renderMembersList() {
    const container = document.getElementById('members-list');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center; color:var(--color-text-dim); padding:1rem;">Cargando...</div>';
    const members = await Org.loadMembers();
    if (!members.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">👥</div>
          <div class="empty-state-title">Sin miembros</div>
          <div class="empty-state-desc">Invita miembros a la organización</div>
        </div>`;
      return;
    }
    container.innerHTML = members.map(m => {
      const roleLabel = { owner: '👑 Dueño', admin: '⚙️ Admin', member: '👤 Miembro' }[m.role] || m.role;
      const date = new Date(m.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
      return `
        <div class="list-item">
          <div class="list-item-info">
            <div class="list-item-name" style="font-size:0.8125rem; color:var(--color-text-dim);">${m.user_id.slice(0, 8)}…</div>
            <div class="list-item-sub">${roleLabel} · Desde ${date}</div>
          </div>
        </div>`;
    }).join('');
  }

  function initMembersTab() {
    initMemberTabs();

    document.getElementById('btn-create-member')?.addEventListener('click', function() {
      const username = document.getElementById('member-username').value.trim();
      const displayName = document.getElementById('member-display-name').value.trim();
      const password = document.getElementById('member-password').value;
      const role = document.getElementById('member-role').value;
      const errorEl = document.getElementById('member-create-error');
      errorEl.classList.add('hidden');

      if (!username || !displayName || !password) {
        errorEl.textContent = 'Completa todos los campos';
        errorEl.classList.remove('hidden');
        return;
      }
      if (password.length < 6) {
        errorEl.textContent = 'La contraseña debe tener al menos 6 caracteres';
        errorEl.classList.remove('hidden');
        return;
      }

      withLoading(this, async () => {
        try {
          await Org.createMemberAccount({ username, password, displayName, role });
          document.getElementById('member-username').value = '';
          document.getElementById('member-display-name').value = '';
          document.getElementById('member-password').value = '';
          showToast(`Cuenta creada para ${displayName}`, 'success');
        } catch (e) {
          errorEl.textContent = e.message;
          errorEl.classList.remove('hidden');
        }
      });
    });

    document.getElementById('btn-generate-code')?.addEventListener('click', function() {
      const role = document.getElementById('invite-role').value;
      withLoading(this, async () => {
        try {
          const code = await Org.generateInviteCode(role);
          await renderInviteCodes();
          showToast(`Código generado: ${code.code}`, 'success', 5000);
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    });
  }

  function initOrgForms() {
    document.getElementById('btn-create-org')?.addEventListener('click', () => openModal('modal-create-org'));
    document.getElementById('btn-join-org')?.addEventListener('click', () => {
      document.getElementById('join-code-input').value = '';
      document.getElementById('join-code-error').classList.add('hidden');
      openModal('modal-join-org');
    });

    document.getElementById('btn-confirm-join')?.addEventListener('click', function() {
      const code = document.getElementById('join-code-input').value.trim();
      const errorEl = document.getElementById('join-code-error');
      errorEl.classList.add('hidden');
      if (!code) {
        errorEl.textContent = 'Ingresa el código de invitación';
        errorEl.classList.remove('hidden');
        return;
      }
      withLoading(this, async () => {
        try {
          await Org.joinByCode(code);
          closeModal('modal-join-org');
          const orgs = await Org.loadUserOrgs();
          if (orgs.length) await loadAndRender(orgs[orgs.length - 1]);
          showToast('Te uniste a la organización', 'success');
        } catch (e) {
          errorEl.textContent = e.message;
          errorEl.classList.remove('hidden');
        }
      });
    });

    // Auto-slug
    document.getElementById('org-name')?.addEventListener('input', e => {
      const slugEl = document.getElementById('org-slug');
      if (!slugEl._touched) slugEl.value = slugify(e.target.value);
    });
    document.getElementById('org-slug')?.addEventListener('input', function() { this._touched = true; });

    document.getElementById('btn-confirm-create-org')?.addEventListener('click', function() {
      const name = document.getElementById('org-name').value.trim();
      const slug = document.getElementById('org-slug').value.trim();
      const errorEl = document.getElementById('create-org-error');
      errorEl.classList.add('hidden');

      if (!name || !slug) {
        errorEl.textContent = 'Nombre y slug son requeridos';
        errorEl.classList.remove('hidden');
        return;
      }
      if (!/^[a-z0-9-]+$/.test(slug)) {
        errorEl.textContent = 'El slug solo puede tener letras, números y guiones';
        errorEl.classList.remove('hidden');
        return;
      }

      withLoading(this, async () => {
        try {
          const org = await Org.createOrg(name, slug);
          closeModal('modal-create-org');
          await Org.loadUserOrgs();
          Store.set({ currentOrg: org });
          await loadAndRender(org);
          showToast('Organización creada', 'success');
        } catch (e) {
          errorEl.textContent = e.message?.includes('duplicate') ? 'Ese slug ya está en uso' : e.message;
          errorEl.classList.remove('hidden');
        }
      });
    });

    // Cambiar de org
    document.getElementById('select-org')?.addEventListener('change', async e => {
      const { orgs } = Store.get();
      const org = orgs.find(o => o.id === e.target.value);
      if (org) await loadAndRender(org);
    });
  }

  async function init() {
    initTabs();
    initAuthForms();
    initOrgForms();
    initMembersTab();
    Directory.initEvents();
    TournamentsList.initEvents();

    const user = await Auth.init();
    if (user) {
      await onSignedIn();
    } else {
      showScreen('screen-auth');
    }
  }

  return { init, onSignedIn, onSignedOut, deleteCode, renderMembersList };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
