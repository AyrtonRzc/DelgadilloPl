const Auth = (() => {

  async function init() {
    const { data: { session } } = await db.auth.getSession();
    if (session?.user) {
      Store.set({ user: session.user });
    }

    db.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        Store.set({ user: session.user });
        if (typeof App !== 'undefined') App.onSignedIn();
      }
      if (event === 'SIGNED_OUT') {
        Store.clear();
        if (typeof App !== 'undefined') App.onSignedOut();
      }
    });

    return session?.user || null;
  }

  async function login(email, password) {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
  }

  async function register(email, password, name) {
    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } }
    });
    if (error) throw error;
    return data.user;
  }

  async function logout() {
    await db.auth.signOut();
  }

  function currentUser() {
    return Store.get().user;
  }

  function requireAuth() {
    if (!currentUser()) {
      window.location.href = 'index.html';
      return false;
    }
    return true;
  }

  return { init, login, register, logout, currentUser, requireAuth };
})();
