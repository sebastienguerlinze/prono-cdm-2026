-- ============================================================
--  Planification de la synchro automatique (à exécuter après
--  avoir déployé la fonction sync-scores).
--  Active les extensions pg_cron + pg_net dans
--  Supabase > Database > Extensions, puis exécute ceci.
-- ============================================================

-- Remplace <PROJECT_REF> par ta référence de projet Supabase
-- et <SERVICE_ROLE_KEY> par ta clé service_role (Settings > API).

select cron.schedule(
  'sync-scores-cdm',
  '*/15 * * * *',            -- toutes les 15 minutes
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.functions.supabase.co/sync-scores',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer <SERVICE_ROLE_KEY>'
    )
  );
  $$
);

-- Pour arrêter plus tard :  select cron.unschedule('sync-scores-cdm');
