const Org = (() => {

  async function loadUserOrgs() {
    const user = Auth.currentUser();
    if (!user) return [];

    const { data, error } = await db
      .from('organization_members')
      .select('role, organizations(id, name, slug, created_by, created_at)')
      .eq('user_id', user.id);

    if (error) { console.error(error); return []; }

    const orgs = (data || []).map(m => ({ ...m.organizations, role: m.role }));
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
    await Promise.all([
      loadPlayers(orgId),
      loadTeams(orgId),
      loadVenues(orgId),
      loadGameModes(orgId),
      loadTournaments(orgId)
    ]);
  }

  async function loadPlayers(orgId) {
    const { data, error } = await db
      .from('players')
      .select('*, teams(id, name, color)')
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

  async function inviteMember(orgId, userEmail) {
    throw new Error('Invitación por email próximamente. Comparte el slug de tu org con el admin.');
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
    inviteMember
  };
})();
