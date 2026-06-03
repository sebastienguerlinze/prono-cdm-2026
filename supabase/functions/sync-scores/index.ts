// ============================================================
//  Edge Function : sync-scores
//  Récupère scores + buteurs des matchs CDM 2026 via API-Football
//  et met à jour la table `fixtures` + `match_scorers`.
//  Déploiement :  supabase functions deploy sync-scores
//  Secret requis : supabase secrets set API_FOOTBALL_KEY=xxxxx
//  Déclenché par pg_cron (voir supabase/cron.sql)
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const LEAGUE = 1          // FIFA World Cup
const SEASON = 2026

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const key = Deno.env.get('API_FOOTBALL_KEY')
  if (!key) return json({ error: 'API_FOOTBALL_KEY manquant' }, 500)

  const headers = { 'x-apisports-key': key }
  // 1) tous les matchs du tournoi avec leur score
  const r = await fetch(`https://v3.football.api-sports.io/fixtures?league=${LEAGUE}&season=${SEASON}`, { headers })
  const data = await r.json()
  const fixtures = data.response || []

  let updated = 0
  for (const fx of fixtures) {
    const st = fx.fixture.status.short                  // NS, 1H, HT, 2H, FT, AET, PEN...
    const status = ['FT', 'AET', 'PEN'].includes(st) ? 'finished' : (['1H', '2H', 'HT', 'ET', 'P'].includes(st) ? 'live' : 'scheduled')
    if (status === 'scheduled') continue

    // appariement par noms d'équipes (la table locale utilise les noms openfootball)
    const home = norm(fx.teams.home.name), away = norm(fx.teams.away.name)
    const { data: rows } = await supabase.from('fixtures').select('id')
      .or(`and(team1.ilike.%${home}%,team2.ilike.%${away}%)`)
      .is('score1', null).limit(1)
    // fallback : si ext_id déjà connu
    let localId = rows?.[0]?.id
    if (!localId) {
      const { data: byext } = await supabase.from('fixtures').select('id').eq('ext_id', fx.fixture.id).limit(1)
      localId = byext?.[0]?.id
    }
    if (!localId) continue

    await supabase.from('fixtures').update({
      ext_id: fx.fixture.id, score1: fx.goals.home, score2: fx.goals.away,
      status, updated_at: new Date().toISOString(),
    }).eq('id', localId)
    updated++

    // 2) buteurs (events) pour les matchs terminés
    if (status === 'finished') {
      const er = await fetch(`https://v3.football.api-sports.io/fixtures/events?fixture=${fx.fixture.id}`, { headers })
      const ev = (await er.json()).response || []
      const goals = ev.filter((e: any) => e.type === 'Goal' && e.detail !== 'Missed Penalty')
      for (const g of goals) {
        await supabase.from('match_scorers').upsert({
          fixture_id: localId, player_name: g.player?.name || 'Inconnu',
          team_code: g.team?.name, minute: g.time?.elapsed ?? null,
        }, { onConflict: 'fixture_id,player_name,minute' })
      }
    }
  }
  return json({ ok: true, updated })
})

const norm = (s: string) => s.replace(/[^\w\s]/g, '').trim()
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
