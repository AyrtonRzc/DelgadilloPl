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
          stats: 'tab-stats',
          login: 'tab-login',
          register: 'tab-register'
        };

        Object.values(tabMap).forEach(id => {
          document.getElementById(id)?.classList.add('hidden');
        });
        if (tabMap[tab]) document.getElementById(tabMap[tab])?.classList.remove('hidden');
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

  function initOrgForms() {
    document.getElementById('btn-create-org')?.addEventListener('click', () => openModal('modal-create-org'));
    document.getElementById('btn-join-org')?.addEventListener('click', () => openModal('modal-join-org'));

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
    Directory.initEvents();
    TournamentsList.initEvents();

    const user = await Auth.init();
    if (user) {
      await onSignedIn();
    } else {
      showScreen('screen-auth');
    }
  }

  return { init, onSignedIn, onSignedOut };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
