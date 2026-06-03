# ⚽ Prono Coupe du Monde 2026 — Guide de déploiement

Application web (PWA) de paris entre amis/famille pour la CDM 2026.
Chacun l'ajoute à l'écran d'accueil de son GSM, parie depuis son téléphone,
et le classement se met à jour en direct.

**Stack :** Vite + React (front) · Supabase (base de données + connexion + synchro auto des scores).
Tout tient dans les offres **gratuites**.

---

## Ce dont tu as besoin (comptes gratuits)

1. **Supabase** — base de données + connexion → https://supabase.com
2. **Vercel** (ou Netlify) — héberger le site → https://vercel.com
3. **API-Football** *(optionnel, pour les scores automatiques)* → https://www.api-football.com (offre gratuite : 100 requêtes/jour, largement suffisant)

Durée totale : ~1 h.

---

## Étape 1 — Base de données (Supabase)

1. Crée un projet sur Supabase (note le mot de passe de la base).
2. Menu **SQL Editor** → **New query**.
3. Colle tout le contenu de `supabase/schema.sql` → **Run**.
4. Nouvelle query → colle `supabase/seed_fixtures.sql` (les 104 matchs) → **Run**.
5. Vérifie dans **Table Editor** que la table `fixtures` contient bien 104 lignes.

> ⚠️ Les heures sont stockées en **UTC**. L'app les affiche automatiquement en **heure belge**.

### Réglage de la connexion par e-mail
- Menu **Authentication → Sign In / Providers** : laisse **Email** activé.
- Menu **Authentication → URL Configuration** :
  - *Site URL* : l'adresse de ton site (tu l'auras à l'étape 2, ex. `https://prono-cdm.vercel.app`)
  - Ajoute la même adresse dans *Redirect URLs*.

---

## Étape 2 — Mettre le site en ligne (Vercel)

1. Mets ce dossier sur un dépôt GitHub (ou utilise `vercel` en ligne de commande).
2. Sur Vercel : **New Project** → importe le dépôt.
   - Framework : **Vite** (détecté automatiquement)
   - Build command : `npm run build` · Output : `dist`
3. Dans **Settings → Environment Variables**, ajoute :
   ```
   VITE_SUPABASE_URL   = (Supabase → Project Settings → API → Project URL)
   VITE_SUPABASE_ANON_KEY = (même page → anon public key)
   ```
4. **Deploy**. Tu obtiens une adresse type `https://prono-cdm.vercel.app`.
5. Reviens à l'étape 1 et mets cette adresse dans *Site URL* + *Redirect URLs* de Supabase.

> Pour tester en local : crée un fichier `.env` (copie de `.env.example`) avec les 2 variables, puis `npm install` et `npm run dev`.

---

## Étape 3 — Installer l'app sur les téléphones

Envoie le lien à tes participants. Sur leur GSM :
- **iPhone (Safari)** : bouton Partager → « Sur l'écran d'accueil ».
- **Android (Chrome)** : menu ⋮ → « Ajouter à l'écran d'accueil ».

L'icône apparaît comme une vraie app. Chacun se connecte avec son e-mail (lien magique), crée ou rejoint un groupe via le **code à 6 caractères**.

---

## Étape 4 *(optionnel)* — Scores & buteurs automatiques

Sans cette étape, tu saisis toi-même les scores (voir plus bas). Avec, tout se met à jour seul.

1. Crée un compte **API-Football**, récupère ta clé API.
2. Installe la CLI Supabase puis, à la racine du projet :
   ```bash
   supabase login
   supabase link --project-ref <TON_PROJECT_REF>
   supabase secrets set API_FOOTBALL_KEY=ta_cle_api
   supabase functions deploy sync-scores
   ```
3. Dans Supabase → **Database → Extensions**, active **pg_cron** et **pg_net**.
4. **SQL Editor** → ouvre `supabase/cron.sql`, remplace `<PROJECT_REF>` et `<SERVICE_ROLE_KEY>`
   (Settings → API → service_role), puis **Run**. La synchro tourne toutes les 15 min.

> La fonction relie les matchs API-Football aux matchs locaux par le nom des équipes.
> Pour les phases finales (placeholders 2A, W74…), elle complète via `ext_id` une fois les équipes connues.

### Saisie manuelle (si tu sautes l'étape 4)
Après chaque match, dans **Table Editor → fixtures** : renseigne `score1`, `score2`, passe `status` à `finished`.
Pour les buteurs : table `match_scorers` (fixture_id + player_name). Le classement se recalcule tout seul.

---

## Comment marche le scoring

Défini **par groupe** à la création (modifiable dans la table `groups`) :
- **Score exact** → `pts_exact` (déf. 3)
- **Bon résultat 1N2** (score faux) → `pts_outcome` (déf. 1)
- **Bonne différence de buts** (bonus) → `pts_goaldiff` (déf. 1)
- **Par buteur correctement désigné** → `pts_scorer` (déf. 1)
- **Pas de prono au coup d'envoi** → compté **0–0** par défaut.
- Les paris se **verrouillent automatiquement** à l'heure du coup d'envoi.

La **cagnotte** = mise × nombre de participants, avec une répartition suggérée 60/30/10.

---

## Ce qui est livré (phase 1) ✅
- Connexion par e-mail, multi-groupes (famille, collègues, amis…)
- 104 matchs pré-chargés, heure belge, verrouillage au coup d'envoi, défaut 0–0
- Barème configurable + bonus buteurs, classement live, cagnotte & répartition
- Synchro auto scores + buteurs (API-Football)

## Phase 2 (à venir)
- Écran de **pari sur les buteurs** (l'option et le barème existent déjà côté base)
- **Mode Fantasy** : composition d'équipe avec budget + transferts entre phases
  (tables `players`, `fantasy_squads`, `fantasy_picks` déjà prêtes)
- Notifications « n'oublie pas de parier », et déduplication fine des équipes pour la synchro.
