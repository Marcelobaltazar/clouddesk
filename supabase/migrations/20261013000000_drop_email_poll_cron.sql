-- ─── Desliga o job desk-email-poll ──────────────────────────────────────────────
-- Criado em 20260716010000_email_cron.sql para chamar desk-inbound-email a cada
-- minuto. O canal de e-mail não está em uso e o job falhou em 100% das 117.767
-- execuções desde 23/07/2026 ("job startup timeout"), enchendo
-- cron.job_run_details até 156 MB — 80% do banco — e consumindo o Disk IO
-- Budget do projeto.
--
-- Já foi desligado à mão em produção em 13/10/2026. Esta migration registra isso
-- para que um banco recriado do zero não volte a agendá-lo. Para reativar o canal
-- de e-mail no futuro, crie uma migration nova que agende o job de novo.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'desk-email-poll') THEN
    PERFORM cron.unschedule('desk-email-poll');
  END IF;
END $$;
