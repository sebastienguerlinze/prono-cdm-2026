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

/* ================= APP ================= */
export default function App() {
  const [session, setSession] = useState(undefined)
  const [toast, setToast] = useState('')
  const notify = useCallback((m) => { setToast(m); setTimeout(() => setToast(''), 2600) }, [])
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])
  if (session === undefined) return <div className="center"><div className="spinner" /></div>
  return (
    <div className="app">
      {!session ? <Auth notify={notify} /> : <Shell session={session} notify={notify} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

/* ================= AUTH (prénom uniquement, sans e-mail) ================= */
function Auth({ notify }) {
  const [name, setName] = useState('')
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
  return (
    <>
      <div className="hero">
        <div className="kicker">⚽ Coupe du Monde 2026</div>
        <h1>Pronos entre<br /><em>Friends</em></h1>
        <p>Parie sur chaque match, grimpe au classement, rafle la cagnotte.</p>
      </div>
      <div className="wrap">
        <div className="card">
          <div className="field"><label>Ton prénom (visible au classement)</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Sébastien"
              onKeyDown={e => e.key === 'Enter' && enter()} /></div>
          <button className="btn" onClick={enter} disabled={busy}>{busy ? '…' : "C'est parti !"}</button>
          <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 12 }}>Pas de mot de passe : tu entres direct avec ton prénom.</p>
        </div>
      </div>
    </>
  )
}

/* ================= SHELL (navigation) ================= */
function Shell({ session, notify }) {
  const uid = session.user.id
  const [group, setGroup] = useState(null) // groupe ouvert
  const [tab, setTab] = useState('matchs')
  if (!group) return <Home uid={uid} notify={notify} onOpen={(g) => { setGroup(g); setTab('matchs') }} onLogout={() => supabase.auth.signOut()} />
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
        {tab === 'fantasy' && <FantasySoon group={group} />}
      </div>
      <nav className="nav">
        {[['matchs', '⚽', 'Matchs'], ['classement', '🏆', 'Classement'], ['cagnotte', '💰', 'Cagnotte'], ['fantasy', '🌟', 'Fantasy']].map(([k, ic, lb]) =>
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><span className="ic">{ic}</span>{lb}</button>)}
      </nav>
    </>
  )
}

/* ================= HOME : liste des groupes ================= */
function Home({ uid, notify, onOpen, onLogout }) {
  const [groups, setGroups] = useState(null)
  const [mode, setMode] = useState(null) // create | join
  const load = useCallback(async () => {
    const { data } = await supabase.from('group_members').select('groups(*)').eq('user_id', uid)
    setGroups((data || []).map(r => r.groups).filter(Boolean))
  }, [uid])
  useEffect(() => { load() }, [load])
  if (mode === 'create') return <CreateGroup uid={uid} notify={notify} onDone={(g) => { setMode(null); load(); if (g) onOpen(g) }} onCancel={() => setMode(null)} />
  if (mode === 'join') return <JoinGroup uid={uid} notify={notify} onDone={() => { setMode(null); load() }} onCancel={() => setMode(null)} />
  return (
    <>
      <div className="topbar">
        <div className="brand"><span className="dot" /><b>Prono CDM 2026</b></div>
        <button className="ghost-btn" onClick={onLogout}>Déconnexion</button>
      </div>
      <div className="wrap">
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
          <button className="btn" onClick={() => setMode('create')}>＋ Créer</button>
          <button className="btn alt" onClick={() => setMode('join')}>Rejoindre</button>
        </div>
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

  useEffect(() => {
    (async () => {
      const { data: fx } = await supabase.from('fixtures').select('*').order('kickoff_utc')
      setFixtures(fx || [])

      // joueurs (pour les listes déroulantes de buteurs)
      const { data: pl } = await supabase.from('players').select('name,team_code,position').order('name')
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
            <FixtureCard key={fx.id} fx={fx} pred={preds[fx.id]} group={group} byTeam={byTeam} scorers={scorers[fx.id]} onSave={save} />
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

function FixtureCard({ fx, pred, group, byTeam, scorers, onSave }) {
  const locked = new Date() >= new Date(fx.kickoff_utc)
  const finished = fx.status === 'finished'
  const [p1, setP1] = useState(pred?.pred1 ?? 0)
  const [p2, setP2] = useState(pred?.pred2 ?? 0)
  const [sc1, setSc1] = useState([])
  const [sc2, setSc2] = useState([])
  const prefilled = useRef(false)

  useEffect(() => { setP1(pred?.pred1 ?? 0); setP2(pred?.pred2 ?? 0) }, [pred])

  // pré-remplissage des buteurs déjà sauvegardés (une seule fois, quand les joueurs sont chargés)
  useEffect(() => {
    if (prefilled.current) return
    if (!byTeam || !Object.keys(byTeam).length) return
    const inT1 = new Set((byTeam[teamCode(fx.team1)] || []).map(p => p.name))
    const a1 = [], a2 = []
    ;(scorers || []).forEach(n => { if (inT1.has(n)) a1.push(n); else a2.push(n) })
    setSc1(resize(a1, pred?.pred1 ?? 0))
    setSc2(resize(a2, pred?.pred2 ?? 0))
    prefilled.current = true
  }, [byTeam, scorers, pred, fx])

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
      const { data: lb } = await supabase.from('leaderboard').select('*').eq('group_id', group.id)
      const ptsMap = {}; (lb || []).forEach(r => ptsMap[r.user_id] = r)
      const merged = (members || []).map(m => ({
        user_id: m.user_id,
        name: m.profiles?.display_name || '—',
        points: ptsMap[m.user_id]?.points || 0,
        good: ptsMap[m.user_id]?.good_results || 0,
      })).sort((a, b) => b.points - a.points)
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
            <div className="lb-name">{r.name} {r.user_id === uid && <span className="muted lb-sub">(toi)</span>}<div className="lb-sub">{r.good} bons résultats</div></div>
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
        <div className="lb-row"><div className="lb-name">🥇 1er</div><div className="lb-pts">{Math.round(pot * 0.6)}€</div></div>
        <div className="lb-row"><div className="lb-name">🥈 2e</div><div className="lb-pts">{Math.round(pot * 0.3)}€</div></div>
        <div className="lb-row"><div className="lb-name">🥉 3e</div><div className="lb-pts">{Math.round(pot * 0.1)}€</div></div>
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
