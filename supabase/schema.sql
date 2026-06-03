-- ============================================================
--  PRONO COUPE DU MONDE 2026 — Schéma Supabase complet
--  À exécuter UNE FOIS dans Supabase > SQL Editor
-- ============================================================

-- ---------- PROFILS (lié à auth.users) ----------
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at  timestamptz default now()
);

-- ---------- MATCHS (pré-chargés, 104 matchs CDM 2026) ----------
create table if not exists fixtures (
  id           int primary key,
  ext_id       bigint,                 -- id API-Football (rempli par la synchro)
  phase        text not null,          -- group | r32 | r16 | qf | sf | third | final
  group_label  text,                   -- A..L pour la phase de groupes
  round_label  text,
  team1        text not null,
  team2        text not null,
  ground       text,
  kickoff_utc  timestamptz not null,   -- coup d'envoi en UTC
  score1       int,                    -- score réel (null tant que pas joué)
  score2       int,
  status       text default 'scheduled', -- scheduled | live | finished
  updated_at   timestamptz default now()
);

-- ---------- BUTEURS RÉELS d'un match (rempli par la synchro) ----------
create table if not exists match_scorers (
  id          bigserial primary key,
  fixture_id  int references fixtures(id) on delete cascade,
  player_name text not null,
  team_code   text,
  minute      int,
  unique (fixture_id, player_name, minute)
);

-- ---------- GROUPES DE PARIS ----------
create table if not exists groups (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  join_code     text unique not null,           -- code à partager (ex: FAM4K2)
  owner_id      uuid references profiles(id) on delete cascade,
  -- mise & cagnotte
  stake_amount  numeric default 0,              -- mise par personne
  currency      text default 'EUR',
  -- options
  fantasy_enabled boolean default false,
  scorers_enabled boolean default true,         -- pari sur les buteurs
  -- barème de points
  pts_exact     int default 3,                  -- score exact
  pts_outcome   int default 1,                  -- bon résultat (1N2) mais score faux
  pts_goaldiff  int default 0,                  -- bonus bonne différence de buts
  pts_scorer    int default 1,                  -- par buteur correctement prédit
  created_at    timestamptz default now()
);

-- ---------- MEMBRES D'UN GROUPE ----------
create table if not exists group_members (
  group_id   uuid references groups(id) on delete cascade,
  user_id    uuid references profiles(id) on delete cascade,
  joined_at  timestamptz default now(),
  primary key (group_id, user_id)
);

-- ---------- PRONOSTICS ----------
create table if not exists predictions (
  id         bigserial primary key,
  group_id   uuid references groups(id) on delete cascade,
  user_id    uuid references profiles(id) on delete cascade,
  fixture_id int references fixtures(id) on delete cascade,
  pred1      int not null default 0,
  pred2      int not null default 0,
  updated_at timestamptz default now(),
  unique (group_id, user_id, fixture_id)
);

-- buteurs pronostiqués (optionnel)
create table if not exists prediction_scorers (
  id            bigserial primary key,
  prediction_id bigint references predictions(id) on delete cascade,
  player_name   text not null,
  unique (prediction_id, player_name)
);

-- ---------- FANTASY (tables prêtes, UI à venir en phase 2) ----------
create table if not exists players (
  id        bigserial primary key,
  ext_id    bigint,
  name      text not null,
  team_code text,
  position  text,                -- GK | DEF | MID | FWD
  price     numeric default 5.0
);

create table if not exists fantasy_squads (
  id        bigserial primary key,
  group_id  uuid references groups(id) on delete cascade,
  user_id   uuid references profiles(id) on delete cascade,
  phase     text not null,       -- group | r32 | r16 ...
  budget    numeric default 100,
  unique (group_id, user_id, phase)
);

create table if not exists fantasy_picks (
  squad_id  bigint references fantasy_squads(id) on delete cascade,
  player_id bigint references players(id) on delete cascade,
  is_captain boolean default false,
  primary key (squad_id, player_id)
);

-- ============================================================
--  FONCTION : score d'un prono vs résultat réel (selon barème groupe)
-- ============================================================
create or replace function prediction_points(
  p_pred1 int, p_pred2 int, p_real1 int, p_real2 int,
  p_exact int, p_outcome int, p_goaldiff int
) returns int language sql immutable as $$
  select case
    when p_real1 is null or p_real2 is null then 0
    when p_pred1 = p_real1 and p_pred2 = p_real2 then p_exact
    when sign(p_pred1 - p_pred2) = sign(p_real1 - p_real2)
      then p_outcome + case when (p_pred1 - p_pred2) = (p_real1 - p_real2) then p_goaldiff else 0 end
    else 0
  end;
$$;

-- ============================================================
--  VUE CLASSEMENT : points par membre & par groupe
--  Les matchs terminés sans prono comptent comme 0-0 (défaut).
-- ============================================================
create or replace view leaderboard with (security_invoker = true) as
with played as (
  select f.id, f.score1, f.score2 from fixtures f where f.status = 'finished'
),
member_match as (
  select gm.group_id, gm.user_id, g.pts_exact, g.pts_outcome, g.pts_goaldiff, g.pts_scorer,
         pl.id as fixture_id, pl.score1, pl.score2,
         coalesce(pr.pred1, 0) as pred1,
         coalesce(pr.pred2, 0) as pred2,
         pr.id as prediction_id
  from group_members gm
  join groups g on g.id = gm.group_id
  cross join played pl
  left join predictions pr
    on pr.group_id = gm.group_id and pr.user_id = gm.user_id and pr.fixture_id = pl.id
),
scored as (
  select group_id, user_id,
    prediction_points(pred1, pred2, score1, score2, pts_exact, pts_outcome, pts_goaldiff) as base_pts,
    -- bonus buteurs : nb de buteurs pronostiqués réellement marqueurs
    coalesce((
      select count(*)::int * mm.pts_scorer
      from prediction_scorers ps
      join match_scorers ms
        on ms.fixture_id = mm.fixture_id and lower(ms.player_name) = lower(ps.player_name)
      where ps.prediction_id = mm.prediction_id
    ),0) as scorer_pts
  from member_match mm
)
select group_id, user_id,
       sum(base_pts + scorer_pts) as points,
       sum(case when base_pts > 0 then 1 else 0 end) as good_results,
       count(*) as played_matches
from scored
group by group_id, user_id;

-- ============================================================
--  RLS (Row Level Security)
-- ============================================================
alter table profiles            enable row level security;
alter table groups              enable row level security;
alter table group_members       enable row level security;
alter table predictions         enable row level security;
alter table prediction_scorers  enable row level security;
alter table fantasy_squads      enable row level security;
alter table fantasy_picks       enable row level security;
-- fixtures, match_scorers, players : lecture publique (données du tournoi)
alter table fixtures      enable row level security;
alter table match_scorers enable row level security;
alter table players       enable row level security;

-- helper : l'utilisateur est-il membre du groupe ?
create or replace function is_member(g uuid) returns boolean language sql security definer stable as $$
  select exists(select 1 from group_members m where m.group_id = g and m.user_id = auth.uid());
$$;

-- PROFILES : chacun gère le sien, lecture par membres de groupes communs
create policy profiles_self  on profiles for all  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_read  on profiles for select using (true);

-- FIXTURES / SCORERS / PLAYERS : lecture publique
create policy fixtures_read on fixtures for select using (true);
create policy scorers_read  on match_scorers for select using (true);
create policy players_read  on players for select using (true);

-- GROUPS : lecture si membre ou via code ; création par tout user connecté ; gestion par owner
create policy groups_read   on groups for select using (is_member(id) or owner_id = auth.uid());
create policy groups_insert on groups for insert with check (owner_id = auth.uid());
create policy groups_update on groups for update using (owner_id = auth.uid());

-- GROUP_MEMBERS : on se voit soi + les membres de ses groupes ; on s'ajoute soi-même
create policy gm_read   on group_members for select using (is_member(group_id) or user_id = auth.uid());
create policy gm_join   on group_members for insert with check (user_id = auth.uid());
create policy gm_leave  on group_members for delete using (user_id = auth.uid());

-- PREDICTIONS : chacun les siennes (écriture), lecture par membres du groupe
create policy pred_read   on predictions for select using (is_member(group_id));
create policy pred_write  on predictions for insert with check (user_id = auth.uid() and is_member(group_id));
create policy pred_update on predictions for update using (user_id = auth.uid());

create policy ps_all on prediction_scorers for all
  using (exists(select 1 from predictions p where p.id = prediction_id and p.user_id = auth.uid()))
  with check (exists(select 1 from predictions p where p.id = prediction_id and p.user_id = auth.uid()));

-- FANTASY
create policy fs_read  on fantasy_squads for select using (is_member(group_id));
create policy fs_write on fantasy_squads for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy fp_all   on fantasy_picks for all
  using (exists(select 1 from fantasy_squads s where s.id = squad_id and s.user_id = auth.uid()))
  with check (exists(select 1 from fantasy_squads s where s.id = squad_id and s.user_id = auth.uid()));

-- ============================================================
--  Rejoindre un groupe par code (sans exposer les autres groupes)
-- ============================================================
create or replace function join_group_by_code(p_code text)
returns groups language plpgsql security definer as $$
declare g groups;
begin
  select * into g from groups where join_code = upper(trim(p_code));
  if g.id is null then raise exception 'CODE_INTROUVABLE'; end if;
  insert into group_members (group_id, user_id) values (g.id, auth.uid())
    on conflict do nothing;
  return g;
end; $$;
grant execute on function join_group_by_code(text) to authenticated;

-- ============================================================
--  Création auto du profil à l'inscription
-- ============================================================
create or replace function handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();
