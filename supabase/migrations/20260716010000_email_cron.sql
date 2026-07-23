-- ─── Cron: poll do Gmail a cada 1 minuto ───────────────────────────────────────
--
-- Usa pg_cron + pg_net para chamar a Edge Function desk-inbound-email
-- periodicamente. Envolvido em DO/EXCEPTION para NUNCA quebrar o db push caso
-- as extensões não estejam habilitadas ou o role não tenha privilégio — nesse
-- caso o cron é criado manualmente pelo Supabase Dashboard (Integrations → Cron),
-- ou o próprio scheduler externo chama a função. Ver EMAIL_SETUP.md.
--
-- A URL/keys vêm de GUCs (definidos no deploy via ALTER DATABASE ... SET):
--   app.settings.edge_url, app.settings.service_role_key, app.settings.cron_secret

DO $outer$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  -- Remove job anterior (idempotente)
  BEGIN
    PERFORM cron.unschedule('desk-email-poll');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  PERFORM cron.schedule(
    'desk-email-poll',
    '* * * * *',
    $job$
    SELECT net.http_post(
      url     := current_setting('app.settings.edge_url', true) || '/desk-inbound-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
        'x-cron-secret', current_setting('app.settings.cron_secret', true)
      ),
      body    := '{}'::jsonb
    );
    $job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Cron do e-mail não configurado automaticamente (%). Configure manualmente no Supabase Dashboard → Cron. Ver EMAIL_SETUP.md.', SQLERRM;
END $outer$;
