import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from './supabaseClient'

/* ---------- utils ---------- */
const BX = 'Europe/Brussels'
const fmtTime = (iso) => new Intl.DateTimeFormat('fr-BE', { timeZone: BX, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
const fmtDay = (iso) => new Intl.DateTimeFormat('fr-BE', { timeZone: BX, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso))
const dayKey = (iso) => new Intl.DateTimeFormat('fr-CA', { timeZone: BX, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
const PHASES = { group: 'Phase de groupes', r32: '16es de finale', r16: '8es de finale', qf: 'Quarts', sf: 'Demi-finales', third: '3e place', final: 'Finale' }
const randCode = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')

/* ---------- buteurs : correspondance des 3 pays écrits différemment ---------- */
const TEAM_FIX = { 'DR Congo': 'Congo DR', 'Cape Verde': 'Cape Verde Islands', 'Turkey': 'Türkiye' }
const teamCode = (name) => (name ? (TEAM_FIX[name] || name) : name)
const resize = (arr, n) => { const out = (arr || []).slice(0, n); while (out.length < n) out.push(''); return out }

// charge TOUS les joueurs par paquets de 1000 (contourne la limite de 1000 lignes de Supabase)
async function fetchAllPlayers(cols) {
  let all = [], from = 0; const size = 1000
  while (true) {
    const { data, error } = await supabase.from('players').select(cols).order('name').range(from, from + size - 1)
    if (error || !data || !data.length) break
    all = all.concat(data)
    if (data.length < size) break
    from += size
  }
  return all
}

/* ================= APP ================= */
export default function App() {
  const [session, setSession] = useState(undefined)
  const [isAdmin, setIsAdmin] = useState(false)
  const [toast, setToast] = useState('')
  const notify = useCallback((m) => { setToast(m); setTimeout(() => setToast(''), 2600) }, [])
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    const uid = session?.user?.id
    if (!uid) { setIsAdmin(false); return }
    supabase.from('profiles').select('is_admin').eq('id', uid).maybeSingle()
      .then(({ data }) => setIsAdmin(!!data?.is_admin))
  }, [session])
  if (session === undefined) return <div className="center"><div className="spinner" /></div>
  return (
    <div className="app">
      {!session ? <Auth notify={notify} /> : <Shell session={session} isAdmin={isAdmin} notify={notify} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

/* ================= AUTH (création au prénom OU reconnexion e-mail) ================= */
function Auth({ notify }) {
  const [mode, setMode] = useState('signup') // 'signup' = prénom · 'login' = e-mail + mot de passe
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pwd, setPwd] = useState('')
  const [busy, setBusy] = useState(false)

  const enter = async () => {
    if (!name.trim()) return notify('Indique ton prénom')
    setBusy(true)
    const { error } = await supabase.auth.signInAnonymously({
      options: { data: { display_name: name.trim() } },
    })
    if (error) { setBusy(false); return notify(error.message) }
    const { data: { user } } = await supabase.auth.getUser()
    if (user) await supabase.from('profiles').upsert({ id: user.id, display_name: name.trim() })
    setBusy(false)
  }

  const login = async () => {
    if (!email.trim() || !pwd) return notify('E-mail et mot de passe requis')
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: pwd })
    setBusy(false)
    if (error) return notify('E-mail ou mot de passe incorrect')
  }

  const linkStyle = { color: 'var(--accent, #12914e)', cursor: 'pointer', textDecoration: 'underline' }

  return (
    <>
      <div className="hero">
        <div className="kicker">⚽ Coupe du Monde 2026</div>
        <h1>Pronos entre<br /><em>Friends</em></h1>
        <p>Parie sur chaque match, grimpe au classement, rafle la cagnotte.</p>
      </div>
      <div className="wrap">
        <div className="card">
          {mode === 'signup' ? (
            <>
              <div className="field"><label>Ton prénom (visible au classement)</label>
                <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Sébastien"
                  onKeyDown={e => e.key === 'Enter' && enter()} /></div>
              <button className="btn" onClick={enter} disabled={busy}>{busy ? '…' : "C'est parti !"}</button>
              <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 14 }}>
                Déjà un compte sécurisé ? <span style={linkStyle} onClick={() => setMode('login')}>Se reconnecter</span>
              </p>
            </>
          ) : (
            <>
              <div className="field"><label>E-mail</label>
                <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="ton@email.com" /></div>
              <div className="field"><label>Mot de passe</label>
                <input className="input" type="password" value={pwd} onChange={e => setPwd(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && login()} placeholder="••••••" /></div>
              <button className="btn" onClick={login} disabled={busy}>{busy ? '…' : 'Se reconnecter'}</button>
              <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 14 }}>
                Première fois ? <span style={linkStyle} onClick={() => setMode('signup')}>Créer un compte avec mon prénom</span>
              </p>
            </>
          )}
        </div>
      </div>
    </>
  )
}

/* ================= SHELL (navigation) ================= */
function Shell({ session, isAdmin, notify }) {
  const uid = session.user.id
  const [group, setGroup] = useState(null) // groupe ouvert
  const [tab, setTab] = useState('matchs')
  if (!group) return <Home uid={uid} email={session.user.email} isAdmin={isAdmin} notify={notify} onOpen={(g) => { setGroup(g); setTab('matchs') }} onLogout={() => supabase.auth.signOut()} />
  return (
    <>
      <div className="topbar">
        <button className="ghost-btn" onClick={() => setGroup(null)}>← Groupes</button>
        <div className="brand"><span>{group.name}</span></div>
        <button className="ghost-btn" onClick={() => supabase.auth.signOut()}>Quitter</button>
      </div>
      <div className="wrap" style={{ paddingTop: 4 }}>
        {tab === 'matchs' && <Matchs group={group} uid={uid} notify={notify} />}
        {tab === 'classement' && <Classement group={group} uid={uid} />}
        {tab === 'cagnotte' && <Cagnotte group={group} />}
        {tab === 'fantasy' && (group.fantasy_enabled ? <Fantasy group={group} uid={uid} notify={notify} /> : <FantasySoon group={group} />)}
        {tab === 'joueurs' && <PlayerRanking />}
      </div>
      <nav className="nav">
        {[['matchs', '⚽', 'Matchs'], ['classement', '🏆', 'Classement'], ['cagnotte', '💰', 'Cagnotte'], ['fantasy', '🌟', 'Fantasy'], ['joueurs', '📊', 'Joueurs']].map(([k, ic, lb]) =>
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><span className="ic">{ic}</span>{lb}</button>)}
      </nav>
    </>
  )
}

/* ================= SÉCURISER SON COMPTE (e-mail + mot de passe) ================= */
function SecureAccount({ email, notify }) {
  const [open, setOpen] = useState(false)
  const [mail, setMail] = useState('')
  const [pwd, setPwd] = useState('')
  const [busy, setBusy] = useState(false)

  if (email) {
    return (
      <div className="card" style={{ marginBottom: 14, borderLeft: '3px solid #12914e' }}>
        <div style={{ fontSize: 13 }}>✅ <b>Compte sécurisé</b> — tu peux te reconnecter partout avec <b>{email}</b>.</div>
      </div>
    )
  }

  const secure = async () => {
    if (!mail.trim() || pwd.length < 6) return notify('E-mail valide + mot de passe (6 caractères min)')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ email: mail.trim().toLowerCase(), password: pwd })
    setBusy(false)
    if (error) return notify(error.message)
    notify('Compte sécurisé ✓ Tu peux maintenant le retrouver partout')
    setOpen(false)
  }

  return (
    <div className="card" style={{ marginBottom: 14, borderLeft: '3px solid #e0a200' }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>🔒 Sécurise ton compte</div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
        Ajoute un e-mail + mot de passe pour retrouver tes pronos sur n'importe quel appareil. Sans ça, une déconnexion = perte d'accès à tes pronos.
      </div>
      {!open ? (
        <button className="btn" onClick={() => setOpen(true)}>Sécuriser mon compte</button>
      ) : (
        <>
          <div className="field"><label>E-mail</label>
            <input className="input" type="email" value={mail} onChange={e => setMail(e.target.value)} placeholder="ton@email.com" /></div>
          <div className="field"><label>Mot de passe (6 caractères min)</label>
            <input className="input" type="password" value={pwd} onChange={e => setPwd(e.target.value)} placeholder="••••••" /></div>
          <div className="row">
            <button className="btn" onClick={secure} disabled={busy}>{busy ? '…' : 'Valider'}</button>
            <button className="btn alt" onClick={() => setOpen(false)} disabled={busy}>Annuler</button>
          </div>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>Aucun e-mail ne te sera envoyé : il sert juste à te reconnecter.</p>
        </>
      )}
    </div>
  )
}

/* ================= HOME : liste des groupes ================= */
function Home({ uid, email, isAdmin, notify, onOpen, onLogout }) {
  const [groups, setGroups] = useState(null)
  const [mode, setMode] = useState(null) // create | join
  const load = useCallback(async () => {
    const { data } = await supabase.from('group_members').select('groups(*)').eq('user_id', uid)
    setGroups((data || []).map(r => r.groups).filter(Boolean))
  }, [uid])
  useEffect(() => { load() }, [load])
  if (mode === 'create') return <CreateGroup uid={uid} notify={notify} onDone={(g) => { setMode(null); load(); if (g) onOpen(g) }} onCancel={() => setMode(null)} />
  if (mode === 'join') return <JoinGroup uid={uid} notify={notify} onDone={() => { setMode(null); load() }} onCancel={() => setMode(null)} />
  if (mode === 'members') return <Members notify={notify} onCancel={() => setMode(null)} />
  return (
    <>
      <div className="topbar">
        <div className="brand"><span className="dot" /><b>Prono CDM 2026</b></div>
        <button className="ghost-btn" onClick={onLogout}>Déconnexion</button>
      </div>
      <div className="wrap">
        <SecureAccount email={email} notify={notify} />
        <h2 style={{ fontSize: 24, margin: '6px 2px 16px' }}>Mes groupes</h2>
        {groups === null ? <div className="center"><div className="spinner" /></div> :
          groups.length === 0 ? <div className="empty">Aucun groupe pour l'instant.<br />Crée le tien ou rejoins celui d'un ami 👇</div> :
            <div className="glist">
              {groups.map(g => (
                <div key={g.id} className="card gitem" onClick={() => onOpen(g)}>
                  <div>
                    <div className="gname">{g.name}</div>
                    <div className="gmeta">Code <span className="code">{g.join_code}</span> · mise {g.stake_amount} {g.currency}</div>
                  </div>
                  <span style={{ fontSize: 22, color: 'var(--muted)' }}>›</span>
                </div>
              ))}
            </div>}
        <div className="row" style={{ marginTop: 18 }}>
          {isAdmin && <button className="btn" onClick={() => setMode('create')}>＋ Créer</button>}
          <button className="btn alt" onClick={() => setMode('join')}>Rejoindre</button>
        </div>
        {isAdmin && <p className="muted" style={{ fontSize: 11.5, textAlign: 'center', marginTop: 10 }}>Mode organisateur : toi seul peux créer un groupe.</p>}
        {isAdmin && <button className="btn alt" style={{ marginTop: 12, width: '100%' }} onClick={() => setMode('members')}>👥 Membres</button>}
      </div>
    </>
  )
}

/* ================= MEMBRES (admin) ================= */
function Members({ notify, onCancel }) {
  const [rows, setRows] = useState(null)
  const [openId, setOpenId] = useState(null) // membre en cours de récupération
  const [mail, setMail] = useState('')
  const [pwd, setPwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)      // { prenom, email, password } après succès

  const load = async () => {
    const { data, error } = await supabase.rpc('admin_list_members')
    if (error) { notify('Err: ' + (error.message || error.code || 'inconnue')); setRows([]); return }
    setRows(data || [])
  }
  useEffect(() => { load() }, [])

  const fmtDate = (iso) => iso ? new Intl.DateTimeFormat('fr-BE', { timeZone: BX, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—'

  const openRecover = (m) => { setOpenId(m.user_id); setMail(m.email || ''); setPwd(''); setDone(null) }

  const recover = async (m) => {
    if (!mail.trim() || pwd.length < 6) return notify('E-mail + mot de passe (6 caractères min)')
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('admin-recover', {
      body: { user_id: m.user_id, email: mail.trim().toLowerCase(), password: pwd },
    })
    setBusy(false)
    if (error || data?.error) { notify('Échec : ' + (data?.error || 'erreur')); return }
    setDone({ prenom: m.prenom, email: mail.trim().toLowerCase(), password: pwd })
    setOpenId(null)
    notify('Compte mis à jour ✓')
    load()
  }

  return (
    <>
      <div className="topbar"><button className="ghost-btn" onClick={onCancel}>← Retour</button><b className="display">Membres</b><span style={{ width: 60 }} /></div>
      <div className="wrap">
        {done && (
          <div className="card" style={{ marginBottom: 14, borderLeft: '3px solid #12914e' }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>✅ Identifiants à transmettre à {done.prenom || 'ce membre'}</div>
            <div style={{ fontSize: 13 }}>E-mail : <b>{done.email}</b></div>
            <div style={{ fontSize: 13 }}>Mot de passe : <b>{done.password}</b></div>
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Il se reconnecte via « Se reconnecter » avec ces identifiants, puis peut changer son mot de passe en sécurisant à nouveau son compte.</div>
            <button className="btn alt" style={{ marginTop: 10 }} onClick={() => setDone(null)}>OK</button>
          </div>
        )}
        {rows === null ? <div className="center"><div className="spinner" /></div> :
          rows.length === 0 ? <div className="empty">Aucun membre.</div> :
            <>
              <p className="muted" style={{ fontSize: 12.5, margin: '2px 2px 12px' }}>{rows.length} inscrits · 🔒 = compte non sécurisé · « Récupérer » = définir e-mail + mot de passe temporaire</p>
              <div className="card" style={{ padding: 0 }}>
                {rows.map(m => (
                  <div key={m.user_id} style={{ borderBottom: '1px solid rgba(125,125,125,.12)', padding: '10px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div>{m.prenom || '—'} {m.compte_securise ? <span title="Sécurisé">✅</span> : <span title="Non sécurisé">🔒</span>}</div>
                        <div className="lb-sub">{m.email || 'pas d\'e-mail'} · {m.nb_groupes} groupe{m.nb_groupes > 1 ? 's' : ''} · vu {fmtDate(m.derniere_connexion)}</div>
                      </div>
                      <button className="ghost-btn" style={{ fontSize: 13 }} onClick={() => openId === m.user_id ? setOpenId(null) : openRecover(m)}>
                        {openId === m.user_id ? 'Fermer' : 'Récupérer'}
                      </button>
                    </div>
                    {openId === m.user_id && (
                      <div style={{ marginTop: 8 }}>
                        <div className="field"><label>E-mail du membre</label>
                          <input className="input" type="email" value={mail} onChange={e => setMail(e.target.value)} placeholder="membre@email.com" /></div>
                        <div className="field"><label>Mot de passe temporaire (6 caractères min)</label>
                          <input className="input" value={pwd} onChange={e => setPwd(e.target.value)} placeholder="ex. CDM2026" /></div>
                        <button className="btn" onClick={() => recover(m)} disabled={busy}>{busy ? '…' : 'Définir les identifiants'}</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>}
      </div>
    </>
  )
}

/* ================= CRÉER UN GROUPE ================= */
function CreateGroup({ uid, notify, onDone, onCancel }) {
  const [f, setF] = useState({ name: '', stake: 10, scorers: true, fantasy: false, exact: 3, outcome: 1, goaldiff: 1, scorer: 1 })
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const create = async () => {
    if (!f.name) return notify('Donne un nom au groupe')
    setBusy(true)
    const code = randCode()
    const { data, error } = await supabase.from('groups').insert({
      name: f.name, join_code: code, owner_id: uid, stake_amount: Number(f.stake) || 0,
      scorers_enabled: f.scorers, fantasy_enabled: f.fantasy,
      pts_exact: f.exact, pts_outcome: f.outcome, pts_goaldiff: f.goaldiff, pts_scorer: f.scorer,
    }).select().single()
    if (error) { setBusy(false); return notify(error.message) }
    await supabase.from('group_members').insert({ group_id: data.id, user_id: uid })
    setBusy(false); notify('Groupe créé 🎉'); onDone(data)
  }
  return (
    <>
      <div className="topbar"><button className="ghost-btn" onClick={onCancel}>← Annuler</button><b className="display">Nouveau groupe</b><span style={{ width: 60 }} /></div>
      <div className="wrap">
        <div className="card">
          <div className="field"><label>Nom du groupe</label>
            <input className="input" value={f.name} onChange={e => set('name', e.target.value)} placeholder="La famille, Les collègues…" /></div>
          <div className="field"><label>Mise par personne (€)</label>
            <input className="input" type="number" inputMode="decimal" value={f.stake} onChange={e => set('stake', e.target.value)} /></div>
        </div>
        <div className="card">
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>Barème de points</h3>
          {[['exact', 'Score exact'], ['outcome', 'Bon résultat (1N2)'], ['goaldiff', 'Bonne différence de buts (bonus)'], ['scorer', 'Par buteur trouvé']].map(([k, lb]) =>
            <div className="row" key={k} style={{ alignItems: 'center', marginBottom: 8 }}>
              <div style={{ flex: 1, fontSize: 14 }}>{lb}</div>
              <input className="input" style={{ width: 80 }} type="number" value={f[k]} onChange={e => set(k, Number(e.target.value))} />
            </div>)}
        </div>
        <div className="card">
          <label className="check"><input type="checkbox" checked={f.scorers} onChange={e => set('scorers', e.target.checked)} />
            <div><div className="t">Pari sur les buteurs</div><div className="d">Chacun peut désigner des buteurs pour gagner des points bonus</div></div></label>
          <label className="check"><input type="checkbox" checked={f.fantasy} onChange={e => set('fantasy', e.target.checked)} />
            <div><div className="t">Mode Fantasy (équipe type) <span className="tag" style={{ marginLeft: 4 }}>bientôt</span></div><div className="d">Composer une équipe avec budget et transferts entre phases</div></div></label>
        </div>
        <button className="btn" onClick={create} disabled={busy}>{busy ? '…' : 'Créer le groupe'}</button>
      </div>
    </>
  )
}

/* ================= REJOINDRE ================= */
function JoinGroup({ uid, notify, onDone, onCancel }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const join = async () => {
    setBusy(true)
    const { data: g, error } = await supabase.rpc('join_group_by_code', { p_code: code })
    setBusy(false)
    if (error || !g) return notify(error?.message?.includes('CODE_INTROUVABLE') ? 'Code introuvable' : 'Code introuvable')
    const grp = Array.isArray(g) ? g[0] : g
    notify('Bienvenue dans ' + (grp?.name || 'le groupe') + ' 🎉'); onDone()
  }
  return (
    <>
      <div className="topbar"><button className="ghost-btn" onClick={onCancel}>← Annuler</button><b className="display">Rejoindre</b><span style={{ width: 60 }} /></div>
      <div className="wrap">
        <div className="card">
          <div className="field"><label>Code du groupe (donné par l'organisateur)</label>
            <input className="input" style={{ textTransform: 'uppercase', letterSpacing: '.2em', textAlign: 'center', fontFamily: 'monospace', fontSize: 22 }}
              value={code} onChange={e => setCode(e.target.value)} placeholder="FAM4K2" maxLength={6} /></div>
          <button className="btn" onClick={join} disabled={busy}>{busy ? '…' : 'Rejoindre le groupe'}</button>
        </div>
      </div>
    </>
  )
}

/* ================= MATCHS & PARIS ================= */
function Matchs({ group, uid, notify }) {
  const [fixtures, setFixtures] = useState(null)
  const [preds, setPreds] = useState({})      // fixture_id -> {id, pred1, pred2}
  const [scorers, setScorers] = useState({})  // fixture_id -> [player_name, ...] (équipe1 + équipe2 mélangés)
  const [byTeam, setByTeam] = useState({})     // team_code -> [{name, position}]
  const [phase, setPhase] = useState('group')
  const [ready, setReady] = useState(false)    // toutes les données chargées ?

  useEffect(() => {
    (async () => {
      const { data: fx } = await supabase.from('fixtures').select('*').order('kickoff_utc')
      setFixtures(fx || [])

      // joueurs (pour les listes déroulantes de buteurs) — tous, par paquets
      const pl = await fetchAllPlayers('name,team_code,position')
      const map = {}
      ;(pl || []).forEach(p => { (map[p.team_code] = map[p.team_code] || []).push({ name: p.name, position: p.position }) })
      setByTeam(map)

      // pronos de score (avec l'id du prono)
      const { data: pr } = await supabase.from('predictions').select('id,fixture_id,pred1,pred2').eq('group_id', group.id).eq('user_id', uid)
      const pm = {}; (pr || []).forEach(p => pm[p.fixture_id] = { id: p.id, pred1: p.pred1, pred2: p.pred2 })
      setPreds(pm)

      // buteurs déjà choisis
      const ids = (pr || []).map(p => p.id)
      if (ids.length) {
        const { data: sc } = await supabase.from('prediction_scorers').select('prediction_id,player_name').in('prediction_id', ids)
        const predToFx = {}; (pr || []).forEach(p => predToFx[p.id] = p.fixture_id)
        const sm = {}
        ;(sc || []).forEach(s => { const fId = predToFx[s.prediction_id]; (sm[fId] = sm[fId] || []).push(s.player_name) })
        setScorers(sm)
      }
      setReady(true)
    })()
  }, [group.id, uid])

  // enregistre le score ET les buteurs en une fois
  const save = async (fx, pred1, pred2, names) => {
    setPreds(s => ({ ...s, [fx.id]: { ...(s[fx.id] || {}), pred1, pred2 } }))
    const { data, error } = await supabase.from('predictions').upsert(
      { group_id: group.id, user_id: uid, fixture_id: fx.id, pred1, pred2, updated_at: new Date().toISOString() },
      { onConflict: 'group_id,user_id,fixture_id' }).select('id').single()
    if (error || !data) { notify('Sauvegarde impossible'); return }
    const predId = data.id
    setPreds(s => ({ ...s, [fx.id]: { id: predId, pred1, pred2 } }))
    // on remplace la liste des buteurs (simple et fiable)
    await supabase.from('prediction_scorers').delete().eq('prediction_id', predId)
    const clean = (names || []).filter(Boolean)
    if (clean.length) {
      await supabase.from('prediction_scorers').insert(clean.map(n => ({ prediction_id: predId, player_name: n })))
    }
    notify('Prono enregistré ✓')
  }

  if (fixtures === null) return <div className="center"><div className="spinner" /></div>
  const list = fixtures.filter(f => f.phase === phase)
  const days = [...new Set(list.map(f => dayKey(f.kickoff_utc)))]
  return (
    <>
      <div className="seg" style={{ marginBottom: 14, overflowX: 'auto' }}>
        {Object.keys(PHASES).map(p => <button key={p} className={phase === p ? 'on' : ''} onClick={() => setPhase(p)} style={{ whiteSpace: 'nowrap' }}>{PHASES[p]}</button>)}
      </div>
      {days.map(d => (
        <div key={d}>
          <div className="daygroup">{fmtDay(list.find(f => dayKey(f.kickoff_utc) === d).kickoff_utc)}</div>
          {list.filter(f => dayKey(f.kickoff_utc) === d).map(fx => (
            <FixtureCard key={fx.id} fx={fx} pred={preds[fx.id]} group={group} byTeam={byTeam} scorers={scorers[fx.id]} ready={ready} onSave={save} />
          ))}
        </div>
      ))}
    </>
  )
}

function ScorerGroup({ team, list, values, disabled, onPick }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>⚽ Buteurs {team}</div>
      {!list
        ? <div className="muted" style={{ fontSize: 12, fontStyle: 'italic' }}>Équipe pas encore connue</div>
        : values.map((v, i) => (
          <select key={i} className="input" style={{ marginBottom: 6 }} value={v} disabled={disabled}
            onChange={e => onPick(i, e.target.value)}>
            <option value="">— choisir un buteur —</option>
            {list.map(p => <option key={p.name} value={p.name}>{p.name}{p.position ? ' (' + p.position + ')' : ''}</option>)}
          </select>
        ))}
    </div>
  )
}

function FixtureCard({ fx, pred, group, byTeam, scorers, ready, onSave }) {
  const locked = new Date() >= new Date(fx.kickoff_utc)
  const finished = fx.status === 'finished'
  const [p1, setP1] = useState(pred?.pred1 ?? 0)
  const [p2, setP2] = useState(pred?.pred2 ?? 0)
  const [sc1, setSc1] = useState([])
  const [sc2, setSc2] = useState([])
  const prefilled = useRef(false)

  useEffect(() => { setP1(pred?.pred1 ?? 0); setP2(pred?.pred2 ?? 0) }, [pred])

  // pré-remplissage des buteurs déjà sauvegardés (une seule fois, quand TOUTES les données sont chargées)
  useEffect(() => {
    if (prefilled.current) return
    if (!ready) return
    if (!byTeam || !Object.keys(byTeam).length) return
    const inT1 = new Set((byTeam[teamCode(fx.team1)] || []).map(p => p.name))
    const a1 = [], a2 = []
    ;(scorers || []).forEach(n => { if (inT1.has(n)) a1.push(n); else a2.push(n) })
    setSc1(resize(a1, pred?.pred1 ?? 0))
    setSc2(resize(a2, pred?.pred2 ?? 0))
    prefilled.current = true
  }, [ready, byTeam, scorers, pred, fx])

  // ajuste le nombre de cases buteurs quand le score change
  useEffect(() => { setSc1(a => resize(a, p1)) }, [p1])
  useEffect(() => { setSc2(a => resize(a, p2)) }, [p2])

  const commit = (np1, np2, ns1, ns2) => onSave(fx, np1, np2, [...ns1, ...ns2])

  const pts = finished ? scoreOf(p1, p2, fx.score1, fx.score2, group) : null
  const showScorers = group.scorers_enabled && !finished && (p1 > 0 || p2 > 0)

  return (
    <div className="card fx">
      <div className="fx-top">
        <span className="fx-time">🕘 {fmtTime(fx.kickoff_utc)}</span>
        {finished ? <span className="tag done">Terminé</span> : locked ? <span className="locked">🔒 Verrouillé</span> : <span className="tag">Ouvert</span>}
      </div>
      <div className="teams">
        <div className="team r">{fx.team1}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="score-in" inputMode="numeric" disabled={locked} value={p1}
            onChange={e => setP1(clamp(e.target.value))} onBlur={() => !locked && commit(p1, p2, sc1, sc2)} />
          <input className="score-in" inputMode="numeric" disabled={locked} value={p2}
            onChange={e => setP2(clamp(e.target.value))} onBlur={() => !locked && commit(p1, p2, sc1, sc2)} />
        </div>
        <div className="team">{fx.team2}</div>
      </div>

      {showScorers && (
        <div style={{ marginTop: 10 }}>
          {p1 > 0 && <ScorerGroup team={fx.team1} list={byTeam[teamCode(fx.team1)]} values={sc1} disabled={locked}
            onPick={(i, v) => setSc1(arr => { const c = [...arr]; c[i] = v; commit(p1, p2, c, sc2); return c })} />}
          {p2 > 0 && <ScorerGroup team={fx.team2} list={byTeam[teamCode(fx.team2)]} values={sc2} disabled={locked}
            onPick={(i, v) => setSc2(arr => { const c = [...arr]; c[i] = v; commit(p1, p2, sc1, c); return c })} />}
        </div>
      )}

      <div className="fx-foot">
        {finished
          ? <><span className="realscore">Résultat : {fx.score1}–{fx.score2}</span><span className="pts">+{pts} pts</span></>
          : <><span className="muted" style={{ fontSize: 12 }}>{locked && !pred ? 'Pas de prono → 0–0 par défaut' : 'Ton prono'}</span>
            <span className="muted" style={{ fontSize: 12 }}>{group.group_label}</span></>}
      </div>
    </div>
  )
}

const clamp = (v) => Math.max(0, Math.min(20, parseInt(v || 0, 10) || 0))

function scoreOf(p1, p2, r1, r2, g) {
  if (r1 == null || r2 == null) return 0
  if (p1 === r1 && p2 === r2) return g.pts_exact
  if (Math.sign(p1 - p2) === Math.sign(r1 - r2)) return g.pts_outcome + ((p1 - p2) === (r1 - r2) ? g.pts_goaldiff : 0)
  return 0
}

/* ================= CLASSEMENT ================= */
function Classement({ group, uid }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    (async () => {
      const { data: members } = await supabase.from('group_members').select('user_id, profiles(display_name)').eq('group_id', group.id)
      const { data: lb } = await supabase.from('general_standings').select('*').eq('group_id', group.id)
      const ptsMap = {}; (lb || []).forEach(r => ptsMap[r.user_id] = r)
      const merged = (members || []).map(m => {
        const r = ptsMap[m.user_id] || {}
        return {
          user_id: m.user_id,
          name: m.profiles?.display_name || '—',
          points: r.total_points || 0,
          bonus: (r.bonus_group || 0) + (r.bonus_final || 0),
          good: r.good_results || 0,
        }
      }).sort((a, b) => b.points - a.points)
      setRows(merged)
    })()
  }, [group.id])
  if (rows === null) return <div className="center"><div className="spinner" /></div>
  return (
    <>
      <h2 style={{ fontSize: 24, margin: '4px 2px 14px' }}>Classement</h2>
      <div className="card" style={{ padding: 0 }}>
        {rows.map((r, i) => (
          <div className="lb-row" key={r.user_id}>
            <div className={'rank r' + (i + 1)}>{i + 1}</div>
            <div className="lb-name">{r.name} {r.user_id === uid && <span className="muted lb-sub">(toi)</span>}<div className="lb-sub">{r.good} bons résultats{r.bonus > 0 ? ` · +${r.bonus} bonus fantasy 🌟` : ''}</div></div>
            <div className="lb-pts">{r.points}<span className="lb-sub" style={{ marginLeft: 4 }}>pts</span></div>
          </div>
        ))}
      </div>
    </>
  )
}

/* ================= CAGNOTTE ================= */
function Cagnotte({ group }) {
  const [n, setN] = useState(null)
  useEffect(() => {
    supabase.from('group_members').select('user_id', { count: 'exact', head: true }).eq('group_id', group.id)
      .then(({ count }) => setN(count || 0))
  }, [group.id])
  const pot = (n || 0) * (group.stake_amount || 0)
  return (
    <>
      <h2 style={{ fontSize: 24, margin: '4px 2px 14px' }}>Cagnotte</h2>
      <div className="pot">
        <div className="card"><div className="muted lb-sub">Participants</div><div className="big">{n ?? '…'}</div></div>
        <div className="card"><div className="muted lb-sub">Mise / pers.</div><div className="big">{group.stake_amount}€</div></div>
      </div>
      <div className="card" style={{ marginTop: 12, textAlign: 'center' }}>
        <div className="muted lb-sub">Cagnotte totale</div>
        <div className="big" style={{ fontSize: 40 }}>{pot}€</div>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>Répartition suggérée</h3>
        <div className="lb-row"><div className="lb-name">🥇 1er</div><div className="lb-pts">{Math.round(pot * 0.5)}€</div></div>
        <div className="lb-row"><div className="lb-name">🥈 2e</div><div className="lb-pts">{Math.round(pot * 0.3)}€</div></div>
        <div className="lb-row"><div className="lb-name">🥉 3e</div><div className="lb-pts">{Math.round(pot * 0.2)}€</div></div>
      </div>
    </>
  )
}

/* ================= FANTASY : composition de l'équipe ================= */
const FANTASY_PHASE = 'group'
const FORMATION = [
  { key: 'Goalkeeper', label: 'Gardien', need: 1, single: 'gardien' },
  { key: 'Defender', label: 'Défenseurs', need: 4, single: 'défenseur' },
  { key: 'Midfielder', label: 'Milieux', need: 4, single: 'milieu' },
  { key: 'Attacker', label: 'Attaquants', need: 2, single: 'attaquant' },
]

function Fantasy({ group, uid, notify }) {
  const [players, setPlayers] = useState(null)
  const [picks, setPicks] = useState([])     // [{player_id, position, name, team_code, is_captain}]
  const [adding, setAdding] = useState(null)  // position en cours d'ajout
  const [q, setQ] = useState('')
  const squadRef = useRef(null)
  const [lockedAt, setLockedAt] = useState(null)     // équipe verrouillée ?
  const [kickoff, setKickoff] = useState(null)        // 1er coup d'envoi de la phase

  useEffect(() => {
    (async () => {
      const pl = await fetchAllPlayers('id,name,team_code,position')
      setPlayers(pl || [])
      const { data: ko } = await supabase.from('fixtures').select('kickoff_utc').eq('phase', FANTASY_PHASE).order('kickoff_utc').limit(1).maybeSingle()
      setKickoff(ko?.kickoff_utc || null)
      const { data: sq } = await supabase.from('fantasy_squads')
        .select('id,locked_at').eq('group_id', group.id).eq('user_id', uid).eq('phase', FANTASY_PHASE).maybeSingle()
      if (sq) {
        squadRef.current = sq.id
        setLockedAt(sq.locked_at || null)
        const { data: fp } = await supabase.from('fantasy_picks').select('player_id,is_captain').eq('squad_id', sq.id)
        const byId = {}; (pl || []).forEach(p => byId[p.id] = p)
        setPicks((fp || []).map(x => {
          const p = byId[x.player_id] || {}
          return { player_id: x.player_id, position: p.position, name: p.name, team_code: p.team_code, is_captain: x.is_captain }
        }))
      }
    })()
  }, [group.id, uid])

  const countPos = (key) => picks.filter(p => p.position === key).length
  const total = picks.length
  const hasCaptain = picks.some(p => p.is_captain)
  const complete = FORMATION.every(f => countPos(f.key) === f.need) && hasCaptain

  const started = kickoff ? new Date() >= new Date(kickoff) : false
  // verrouillé si : explicitement verrouillé, OU équipe complète et tournoi commencé
  const locked = !!lockedAt || (complete && started)

  const saveSquad = async (list) => {
    if (locked) return
    let id = squadRef.current
    if (!id) {
      const { data, error } = await supabase.from('fantasy_squads')
        .insert({ group_id: group.id, user_id: uid, phase: FANTASY_PHASE, budget: 0 }).select('id').single()
      if (error || !data) { notify('Sauvegarde impossible'); return }
      id = data.id; squadRef.current = id
    }
    await supabase.from('fantasy_picks').delete().eq('squad_id', id)
    if (list.length) {
      await supabase.from('fantasy_picks').insert(list.map(p => ({ squad_id: id, player_id: p.player_id, is_captain: !!p.is_captain })))
    }
    // si l'équipe devient complète APRÈS le début du tournoi : on la verrouille à l'instant T
    const isComplete = FORMATION.every(f => list.filter(x => x.position === f.key).length === f.need) && list.some(x => x.is_captain)
    if (isComplete && started && !lockedAt) {
      const now = new Date().toISOString()
      await supabase.from('fantasy_squads').update({ locked_at: now }).eq('id', id)
      setLockedAt(now)
      notify('Équipe complète et verrouillée ✓ Tes points comptent à partir de maintenant')
      return
    }
    notify('Équipe enregistrée ✓')
  }

  const addPlayer = (p) => {
    if (locked) return notify('Équipe verrouillée')
    const need = FORMATION.find(f => f.key === p.position)?.need ?? 0
    if (picks.filter(x => x.position === p.position).length >= need) return notify('Ce secteur est complet')
    if (picks.some(x => x.player_id === p.id)) return notify('Déjà dans ton équipe')
    const next = [...picks, { player_id: p.id, position: p.position, name: p.name, team_code: p.team_code, is_captain: false }]
    setPicks(next); setQ(''); saveSquad(next)
    if (next.filter(x => x.position === p.position).length >= need) setAdding(null)
  }
  const removePlayer = (player_id) => { if (locked) return notify('Équipe verrouillée'); const next = picks.filter(p => p.player_id !== player_id); setPicks(next); saveSquad(next) }
  const setCaptain = (player_id) => { if (locked) return notify('Équipe verrouillée'); const next = picks.map(p => ({ ...p, is_captain: p.player_id === player_id })); setPicks(next); saveSquad(next) }

  if (players === null) return <div className="center"><div className="spinner" /></div>

  const pickedIds = new Set(picks.map(p => p.player_id))
  const filtered = adding
    ? players.filter(p => p.position === adding && !pickedIds.has(p.id) && (
      p.name.toLowerCase().includes(q.toLowerCase()) || (p.team_code || '').toLowerCase().includes(q.toLowerCase())
    )).slice(0, 60)
    : []

  return (
    <>
      <h2 style={{ fontSize: 24, margin: '4px 2px 10px' }}>Mon équipe Fantasy</h2>
      {locked && (
        <div className="card" style={{ marginBottom: 12, borderLeft: '3px solid #12914e' }}>
          <span style={{ fontSize: 13 }}>🔒 <b>Équipe verrouillée</b> — le tournoi a commencé, plus de changement possible.</span>
        </div>
      )}
      {!locked && started && !complete && (
        <div className="card" style={{ marginBottom: 12, borderLeft: '3px solid #e0a200' }}>
          <span style={{ fontSize: 13 }}>⚠️ <b>Le tournoi a commencé.</b> Tu peux encore composer ton équipe, mais tu ne marqueras <b>pas</b> les points des matchs déjà joués. Elle se <b>verrouille dès qu'elle est complète</b>.</span>
        </div>
      )}
      <div className="card" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div><b>{total}/11</b> joueurs</div>
        <span className={complete ? 'tag done' : 'tag'}>{complete ? 'Équipe complète ✅' : (total === 11 && !hasCaptain ? 'Choisis un capitaine ⭐' : 'À compléter')}</span>
      </div>

      {FORMATION.map(sec => {
        const chosen = picks.filter(p => p.position === sec.key)
        const full = chosen.length >= sec.need
        return (
          <div className="card" key={sec.key} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <b>{sec.label}</b><span className="muted">{chosen.length}/{sec.need}</span>
            </div>
            {chosen.map(p => (
              <div key={p.player_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                <button className="ghost-btn" title="Désigner capitaine" onClick={() => setCaptain(p.player_id)} style={{ fontSize: 18, padding: 0 }}>{p.is_captain ? '⭐' : '☆'}</button>
                <div style={{ flex: 1 }}>{p.name} <span className="muted" style={{ fontSize: 12 }}>· {p.team_code}</span></div>
                {!locked && <button className="ghost-btn" onClick={() => removePlayer(p.player_id)} style={{ color: 'var(--muted)' }}>✕</button>}
              </div>
            ))}
            {!locked && !full && adding !== sec.key &&
              <button className="btn alt" style={{ marginTop: 6 }} onClick={() => { setAdding(sec.key); setQ('') }}>＋ Ajouter un {sec.single}</button>}
            {adding === sec.key && (
              <div style={{ marginTop: 8 }}>
                <input className="input" autoFocus placeholder="Tape un nom ou un pays…" value={q} onChange={e => setQ(e.target.value)} />
                <div style={{ maxHeight: 240, overflowY: 'auto', marginTop: 6 }}>
                  {filtered.map(p => (
                    <div key={p.id} onClick={() => addPlayer(p)} style={{ padding: '8px 6px', borderBottom: '1px solid rgba(125,125,125,.15)', cursor: 'pointer' }}>
                      {p.name} <span className="muted" style={{ fontSize: 12 }}>· {p.team_code}</span>
                    </div>
                  ))}
                  {!filtered.length && <div className="muted" style={{ padding: 8, fontSize: 13 }}>Aucun joueur trouvé.</div>}
                </div>
                <button className="ghost-btn" style={{ marginTop: 6 }} onClick={() => { setAdding(null); setQ('') }}>Fermer</button>
              </div>
            )}
          </div>
        )
      })}

      <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 4 }}>
        Ton équipe se sauvegarde toute seule. Le ⭐ désigne ton capitaine (points ×2).
      </p>
    </>
  )
}

/* ================= CLASSEMENT DES JOUEURS PAR SECTEUR ================= */
const SECTORS = [
  { key: 'Goalkeeper', label: 'Gardiens' },
  { key: 'Defender', label: 'Défenseurs' },
  { key: 'Midfielder', label: 'Milieux' },
  { key: 'Attacker', label: 'Attaquants' },
]

function PlayerRanking() {
  const [rows, setRows] = useState(null)
  const [sector, setSector] = useState('Attacker')
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('player_ranking').select('*').order('total_points', { ascending: false })
      setRows(data || [])
    })()
  }, [])
  if (rows === null) return <div className="center"><div className="spinner" /></div>
  const anyPlayed = rows.some(r => r.matches > 0)
  const list = rows.filter(r => r.position === sector).slice(0, 30)
  return (
    <>
      <h2 style={{ fontSize: 24, margin: '4px 2px 12px' }}>Classement des joueurs</h2>
      {!anyPlayed &&
        <div className="card" style={{ marginBottom: 12 }}>
          <span className="muted" style={{ fontSize: 13 }}>📊 Ce classement se remplit tout seul au fil des matchs. Reviens après les premières rencontres !</span>
        </div>}
      <div className="seg" style={{ marginBottom: 12, overflowX: 'auto' }}>
        {SECTORS.map(s => <button key={s.key} className={sector === s.key ? 'on' : ''} onClick={() => setSector(s.key)} style={{ whiteSpace: 'nowrap' }}>{s.label}</button>)}
      </div>
      <div className="card" style={{ padding: 0 }}>
        {list.map((r, i) => (
          <div className="lb-row" key={r.id}>
            <div className={'rank r' + (i + 1)}>{i + 1}</div>
            <div className="lb-name">{r.name}<div className="lb-sub">{r.team_code} · {r.matches} match{r.matches > 1 ? 's' : ''}</div></div>
            <div className="lb-pts">{r.total_points}<span className="lb-sub" style={{ marginLeft: 4 }}>pts</span></div>
          </div>
        ))}
        {!list.length && <div className="empty" style={{ padding: 20 }}>Aucun joueur dans ce secteur.</div>}
      </div>
    </>
  )
}

function FantasySoon({ group }) {
  return (
    <div className="empty soon">
      <div style={{ fontSize: 42, marginBottom: 8 }}>🌟</div>
      <h3 className="display" style={{ fontSize: 20 }}>Mode Fantasy</h3>
      <p>{group.fantasy_enabled
        ? "Activé pour ce groupe — l'écran de composition d'équipe (budget + transferts entre phases) arrive en phase 2."
        : "Non activé pour ce groupe."}</p>
    </div>
  )
}
