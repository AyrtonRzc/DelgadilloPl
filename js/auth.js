const Auth = (() => {

  let _unsubscribeAuth = null;

  // Dominio usado internamente para cuentas sin email real
  // Supabase acepta cualquier formato válido de email
  const FAKE_DOMAIN = '@poolapp.app';

  function isEmail(value) {
    return value.includes('@');
  }

  function usernameToEmail(username) {
    return `${username.toLowerCase()}${FAKE_DOMAIN}`;
  }

  async function init() {
    const { data: { session } } = await db.auth.getSession();
    if (session?.user) {
      Store.set({ user: session.user });
    }

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

  // Acepta usuario o email. Si contiene @ lo trata como email directo.
  async function login(usernameOrEmail, password) {
    const email = isEmail(usernameOrEmail)
      ? usernameOrEmail
      : usernameToEmail(usernameOrEmail);

    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
      // Mensaje más amigable
      if (error.message?.toLowerCase().includes('invalid login')) {
        throw new Error('Usuario o contraseña incorrectos');
      }
      throw error;
    }
    return data.user;
  }

  async function register(username, password, displayName) {
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
        },
        // No requiere confirmación de email
        emailRedirectTo: undefined
      }
    });

    if (error) {
      if (error.message?.toLowerCase().includes('already registered') ||
          error.message?.toLowerCase().includes('user already registered')) {
        throw new Error('Ese usuario ya existe');
      }
      throw error;
    }

    // Supabase puede devolver user null si requiere confirmación — verificar
    if (!data.user && !data.session) {
      throw new Error('No se pudo crear la cuenta. Verifica que la confirmación de email esté desactivada en Supabase.');
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
    // Primero metadato, luego extraer del email quitando el dominio fake
    return user?.user_metadata?.username
      || user?.email?.replace(FAKE_DOMAIN, '')
      || user?.email
      || '';
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
