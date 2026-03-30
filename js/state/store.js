// Store global de la app — estado en memoria + localStorage como respaldo

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const Store = (() => {
  const KEY = 'pool_state';

  let state = {
    user: null,
    orgs: [],          // organizaciones del usuario
    currentOrg: null,  // org seleccionada
    players: [],
    teams: [],
    venues: [],
    gameModes: [],
    tournaments: [],
    activeTournament: null  // torneo cargado en tournament.html
  };

  function get() { return state; }

  function set(patch) {
    state = { ...state, ...patch };
  }

  function save() {
    try {
      const toSave = {
        currentOrgId: state.currentOrg?.id || null,
        activeTournamentId: state.activeTournament?.id || null
      };
      localStorage.setItem(KEY, JSON.stringify(toSave));
    } catch (_) {}
  }

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch (_) { return {}; }
  }

  function clear() {
    localStorage.removeItem(KEY);
    state = { user: null, orgs: [], currentOrg: null, players: [], teams: [], venues: [], gameModes: [], tournaments: [], activeTournament: null };
  }

  return { get, set, save, load, clear };
})();
