const Auth = (() => {

  let _unsubscribeAuth = null;

  const FAKE_DOMAIN = '@poolapp.internal';

  function usernameToEmail(username) {
    return `${username.toLowerCase()}${FAKE_DOMAIN}`;
  }

  async function init() {
    const { data: { session } } = await db.auth.getSession();
    if (session?.user) {
      Store.set({ user: session.user });
    }

    // Desuscribir listener anterior si existe para evitar acumulación
    if (_unsubscribeAuth) {
      _unsubscribeAuth();
      _unsubscribeAuth = null;
    }

    const { data: { subscription } } = db.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        Store.set({ user: session.user });
        if (typeof App !== 'undefined') App.onSignedIn();
      }
      if (event === 'SIGNED_OUT') {
        Store.clear();
        if (typeof App !== 'undefined') App.onSignedOut();
      }
    });
    _unsubscribeAuth = () => subscription.unsubscribe();

    return session?.user || null;
  }

  async function login(username, password) {
    const email = usernameToEmail(username);
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
  }

  async function register(username, password, displayName) {
    // Validar que el username solo tenga caracteres permitidos
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
      throw new Error('El usuario solo puede tener letras, números, puntos, guiones y _');
    }

    const email = usernameToEmail(username);

    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: username.toLowerCase(),
          full_name: displayName
        }
      }
    });

    if (error) {
      if (error.message?.toLowerCase().includes('already registered')) {
        throw new Error('Ese usuario ya existe');
      }
      throw error;
    }

    return data.user;
  }

  async function logout() {
    await db.auth.signOut();
  }

  function currentUser() {
    return Store.get().user;
  }

  function currentUsername() {
    const user = currentUser();
    return user?.user_metadata?.username || user?.email?.replace(FAKE_DOMAIN, '') || '';
  }

  function requireAuth() {
    if (!currentUser()) {
      window.location.href = 'index.html';
      return false;
    }
    return true;
  }

  return { init, login, register, logout, currentUser, currentUsername, requireAuth };
})();
