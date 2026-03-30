const Org = (() => {

  async function loadUserOrgs() {
    const user = Auth.currentUser();
    if (!user) return [];

    const { data, error } = await db
      .from('organization_members')
      .select('role, organizations(id, name, slug, created_by, created_at)')
      .eq('user_id', user.id);

    if (error) { console.error(error); return []; }

    const orgs = (data || [])
      .filter(m => m.organizations)
      .map(m => ({ ...m.organizations, role: m.role }));
    Store.set({ orgs });
    return orgs;
  }

  async function createOrg(name, slug) {
    const user = Auth.currentUser();
    if (!user) throw new Error('No autenticado');

    const { data: org, error: orgError } = await db
      .from('organizations')
      .insert({ name, slug, created_by: user.id })
      .select()
      .single();

    if (orgError) throw orgError;

    const { error: memberError } = await db
      .from('organization_members')
      .insert({ org_id: org.id, user_id: user.id, role: 'owner' });

    if (memberError) throw memberError;

    return org;
  }

  async function selectOrg(org) {
    Store.set({ currentOrg: org, players: [], teams: [], venues: [], gameModes: [], tournaments: [] });
    Store.save();
    await loadOrgData(org.id);
  }

  async function loadOrgData(orgId) {
    const results = await Promise.allSettled([
      loadPlayers(orgId),
      loadTeams(orgId),
      loadVenues(orgId),
      loadGameModes(orgId),
      loadTournaments(orgId)
    ]);
    results.forEach(r => {
      if (r.status === 'rejected') console.error('Error cargando datos de org:', r.reason);
    });
  }

  async function loadPlayers(orgId) {
    const { data, error } = await db
      .from('players')
      .select('*, teams(id, name, color, logo_url)')
      .eq('org_id', orgId)
      .order('name');
    if (!error) Store.set({ players: data || [] });
  }

  async function loadTeams(orgId) {
    const { data, error } = await db
      .from('teams')
      .select('*')
      .eq('org_id', orgId)
      .order('name');
    if (!error) Store.set({ teams: data || [] });
  }

  async function loadVenues(orgId) {
    const { data, error } = await db
      .from('venues')
      .select('*')
      .eq('org_id', orgId)
      .order('name');
    if (!error) Store.set({ venues: data || [] });
  }

  async function loadGameModes(orgId) {
    const { data, error } = await db
      .from('game_modes')
      .select('*')
      .or(`is_system.eq.true,org_id.eq.${orgId}`)
      .order('name');
    if (!error) Store.set({ gameModes: data || [] });
  }

  async function loadTournaments(orgId) {
    const { data, error } = await db
      .from('tournaments')
      .select('*, venues(name), game_modes(name)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
    if (!error) Store.set({ tournaments: data || [] });
  }

  // ── CREAR CUENTA PARA MIEMBRO (opción A) ─────────────
  async function createMemberAccount({ username, password, displayName, role }) {
    const org = Store.get().currentOrg;
    if (!org) throw new Error('Sin organización');

    // Guardar sesión del admin y silenciar eventos de auth durante el proceso
    const { data: { session: adminSession } } = await db.auth.getSession();
    Auth.suppressEvents(true);

    let signUpData, signUpError;
    try {
      const email = `${username.toLowerCase()}@poolapp.app`;
      ({ data: signUpData, error: signUpError } = await db.auth.signUp({
        email,
        password,
        options: { data: { username: username.toLowerCase(), full_name: displayName } }
      }));
    } finally {
      // Restaurar sesión del admin siempre, pase lo que pase
      if (adminSession) {
        await db.auth.setSession({
          access_token: adminSession.access_token,
          refresh_token: adminSession.refresh_token
        });
      }
      Auth.suppressEvents(false);
    }

    if (signUpError) {
      if (signUpError.message?.toLowerCase().includes('already registered')) {
        throw new Error('Ese usuario ya existe');
      }
      throw signUpError;
    }

    const newUser = signUpData?.user || signUpData?.session?.user;
    if (!newUser) throw new Error('No se pudo crear la cuenta. Verifica que "Confirm email" esté desactivado en Supabase.');

    // Agregar como miembro de la org usando la sesión restaurada del admin
    const { error: memberError } = await db
      .from('organization_members')
      .insert({ org_id: org.id, user_id: newUser.id, role: role || 'member' });

    if (memberError) {
      console.error('Error agregando miembro:', memberError);
      throw new Error(`Cuenta creada pero no se pudo agregar a la org: ${memberError.message}`);
    }

    return newUser;
  }

  // ── CÓDIGOS DE INVITACIÓN (opción B) ─────────────────
  async function generateInviteCode(role = 'member') {
    const org = Store.get().currentOrg;
    if (!org) throw new Error('Sin organización');
    const user = Auth.currentUser();

    const { data, error } = await db
      .from('org_invite_codes')
      .insert({
        org_id: org.id,
        role,
        created_by: user.id
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async function loadInviteCodes() {
    const org = Store.get().currentOrg;
    if (!org) return [];

    const { data, error } = await db
      .from('org_invite_codes')
      .select('*')
      .eq('org_id', org.id)
      .order('created_at', { ascending: false });

    if (error) return [];
    return data || [];
  }

  async function deleteInviteCode(id) {
    const { error } = await db.from('org_invite_codes').delete().eq('id', id);
    if (error) throw error;
  }

  async function joinByCode(code) {
    const { data, error } = await db.rpc('join_org_by_code', { p_code: code.toUpperCase() });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function loadMembers() {
    const org = Store.get().currentOrg;
    if (!org) return [];

    const { data, error } = await db
      .from('organization_members')
      .select('user_id, role, created_at')
      .eq('org_id', org.id);

    if (error) return [];
    return data || [];
  }

  return {
    loadUserOrgs,
    createOrg,
    selectOrg,
    loadOrgData,
    loadPlayers,
    loadTeams,
    loadVenues,
    loadGameModes,
    loadTournaments,
    createMemberAccount,
    generateInviteCode,
    loadInviteCodes,
    deleteInviteCode,
    joinByCode,
    loadMembers
  };
})();
