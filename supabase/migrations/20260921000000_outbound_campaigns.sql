-- ─── Disparos (outbound): Avisos, Novidades, Banners e Tours guiados ───────────
--
-- Comunicação proativa dentro do bubble do cliente — o equivalente ao "Saídas"
-- (Outbound) do Intercom: Post, News item, Banner e Tour. Tudo é criado e
-- gerenciado pelo painel (Configurações › Disparos), sem mexer em código.
--
-- Modelo:
--   • desk_campaigns          — um registro por disparo, de qualquer tipo. O que
--                               muda entre os tipos vive em `content` (JSONB);
--                               o que é comum (status, agenda, público) é coluna.
--   • desk_campaign_receipts  — UMA linha por (disparo, cliente): quando viu,
--                               clicou, fechou, concluiu, em que passo do tour
--                               parou e qual reação deixou. É daqui que saem
--                               tanto o "não mostrar de novo" do widget quanto
--                               as métricas do painel (pessoas únicas, não
--                               impressões).
--   • desk_campaign_stats     — view agregada por disparo para a lista do painel.
--
-- Segurança (mesmo desenho do restante do widget, ver 20260714000000):
--   • Operadores (is_desk_agent) gerenciam desk_campaigns e LEEM os receipts.
--   • O widget NÃO toca nestas tabelas: leitura de disparos elegíveis e
--     gravação de receipts passam pelo gateway desk-widget-api (service role),
--     que verifica a identidade do cliente por HMAC antes de qualquer coisa.

-- ── 1. Disparos ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.desk_campaigns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type             TEXT NOT NULL CHECK (type IN ('notice', 'news', 'banner', 'tour')),
  -- Nome interno (só o painel vê). O título que o cliente lê está em content.
  name             TEXT NOT NULL,
  -- draft → active ⇄ paused → archived. "Agendado" e "Encerrado" são derivados
  -- de starts_at/ends_at sobre um disparo active — não são estados próprios,
  -- senão um cron teria que virar o status na hora certa.
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  content          JSONB NOT NULL DEFAULT '{}'::jsonb,
  audience         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Desempate quando mais de um disparo do mesmo tipo é elegível (só um banner
  -- e só um popup por vez): maior primeiro, depois o publicado mais recente.
  priority         INTEGER NOT NULL DEFAULT 0,
  starts_at        TIMESTAMPTZ,
  ends_at          TIMESTAMPTZ,
  published_at     TIMESTAMPTZ,
  -- "Rosto" do aviso/novidade: o operador cujo nome e avatar aparecem no card.
  sender_agent_id  UUID REFERENCES public.desk_agents(id) ON DELETE SET NULL,
  created_by       UUID REFERENCES public.desk_agents(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT desk_campaigns_schedule_order
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_desk_campaigns_live
  ON public.desk_campaigns (type, priority DESC, published_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_desk_campaigns_status
  ON public.desk_campaigns (status, updated_at DESC);

DROP TRIGGER IF EXISTS desk_campaigns_updated_at ON public.desk_campaigns;
CREATE TRIGGER desk_campaigns_updated_at
  BEFORE UPDATE ON public.desk_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. Receipts (estado por cliente + base das métricas) ────────────────────────
CREATE TABLE IF NOT EXISTS public.desk_campaign_receipts (
  campaign_id    UUID NOT NULL REFERENCES public.desk_campaigns(id) ON DELETE CASCADE,
  -- E-mail verificado pelo gateway (lowercase). É a identidade do cliente no
  -- widget — a mesma chave usada em desk_conversations.user_email.
  email          TEXT NOT NULL,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_count     INTEGER NOT NULL DEFAULT 1,
  clicked_at     TIMESTAMPTZ,
  dismissed_at   TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  -- Tour: maior índice de passo alcançado (0-based). Funil por etapa no painel.
  step_reached   INTEGER,
  -- Novidade: reação do cliente (ex.: '👍', '❤️', '🎉'). NULL = sem reação.
  reaction       TEXT,
  PRIMARY KEY (campaign_id, email)
);

CREATE INDEX IF NOT EXISTS idx_desk_campaign_receipts_email
  ON public.desk_campaign_receipts (email);

CREATE INDEX IF NOT EXISTS idx_desk_campaign_receipts_seen
  ON public.desk_campaign_receipts (campaign_id, first_seen_at);

-- ── 3. RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.desk_campaigns         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desk_campaign_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agents_full_access_desk_campaigns" ON public.desk_campaigns;
CREATE POLICY "agents_full_access_desk_campaigns"
  ON public.desk_campaigns FOR ALL
  USING (public.is_desk_agent())
  WITH CHECK (public.is_desk_agent());

-- Receipts: operadores só leem (métricas). Quem escreve é o gateway com
-- service role, depois de validar a identidade do cliente.
DROP POLICY IF EXISTS "agents_read_desk_campaign_receipts" ON public.desk_campaign_receipts;
CREATE POLICY "agents_read_desk_campaign_receipts"
  ON public.desk_campaign_receipts FOR SELECT
  USING (public.is_desk_agent());

-- ── 4. Métricas agregadas por disparo ───────────────────────────────────────────
-- security_invoker: a view roda com as permissões de quem consulta, então a RLS
-- dos receipts continua valendo (só operador enxerga).
--
--   seen       — pessoas únicas que viram
--   clicked    — pessoas que clicaram no CTA / "saiba mais"
--   dismissed  — pessoas que fecharam SEM interagir (fechou e nunca clicou)
--   completed  — tours concluídos até o último passo
--   started    — tours em que o cliente passou do primeiro passo
--   reactions  — { "👍": 12, "❤️": 3 } (novidades)
CREATE OR REPLACE VIEW public.desk_campaign_stats
WITH (security_invoker = true) AS
SELECT
  r.campaign_id,
  COUNT(*)::integer                                                              AS seen,
  COUNT(*) FILTER (WHERE r.clicked_at IS NOT NULL)::integer                      AS clicked,
  COUNT(*) FILTER (WHERE r.dismissed_at IS NOT NULL AND r.clicked_at IS NULL)::integer AS dismissed,
  COUNT(*) FILTER (WHERE r.completed_at IS NOT NULL)::integer                    AS completed,
  COUNT(*) FILTER (WHERE r.step_reached IS NOT NULL AND r.step_reached > 0)::integer AS started,
  COALESCE(
    (SELECT jsonb_object_agg(x.reaction, x.total)
       FROM (SELECT reaction, COUNT(*)::integer AS total
               FROM public.desk_campaign_receipts
              WHERE campaign_id = r.campaign_id AND reaction IS NOT NULL
              GROUP BY reaction) x),
    '{}'::jsonb
  )                                                                              AS reactions,
  MAX(r.last_seen_at)                                                            AS last_seen_at
FROM public.desk_campaign_receipts r
GROUP BY r.campaign_id;

GRANT SELECT ON public.desk_campaign_stats TO authenticated, service_role;

-- ── 5. Gravação de receipt (uma chamada, sem corrida) ───────────────────────────
-- Chamada só pelo gateway (service role). Cada evento mexe apenas na coluna
-- dele — `seen` repetido incrementa seen_count, `click` não apaga um dismiss
-- anterior, etc. — para as métricas nunca contarem a mesma pessoa duas vezes.
CREATE OR REPLACE FUNCTION public.desk_campaign_track(
  p_campaign_id uuid,
  p_email       text,
  p_event       text,            -- seen | click | dismiss | complete | step | react
  p_step        integer DEFAULT NULL,
  p_reaction    text    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF p_event NOT IN ('seen', 'click', 'dismiss', 'complete', 'step', 'react') THEN
    RAISE EXCEPTION 'evento inválido: %', p_event;
  END IF;

  INSERT INTO desk_campaign_receipts AS r (
    campaign_id, email, first_seen_at, last_seen_at, seen_count,
    clicked_at, dismissed_at, completed_at, step_reached, reaction
  )
  VALUES (
    p_campaign_id, p_email, v_now, v_now, 1,
    CASE WHEN p_event = 'click'    THEN v_now END,
    CASE WHEN p_event = 'dismiss'  THEN v_now END,
    CASE WHEN p_event = 'complete' THEN v_now END,
    CASE WHEN p_event = 'step'     THEN p_step
         WHEN p_event = 'complete' THEN p_step END,
    CASE WHEN p_event = 'react'    THEN p_reaction END
  )
  ON CONFLICT (campaign_id, email) DO UPDATE SET
    last_seen_at = v_now,
    seen_count   = CASE WHEN p_event = 'seen' THEN r.seen_count + 1 ELSE r.seen_count END,
    clicked_at   = CASE WHEN p_event = 'click'    THEN COALESCE(r.clicked_at, v_now)   ELSE r.clicked_at   END,
    dismissed_at = CASE WHEN p_event = 'dismiss'  THEN COALESCE(r.dismissed_at, v_now) ELSE r.dismissed_at END,
    completed_at = CASE WHEN p_event = 'complete' THEN COALESCE(r.completed_at, v_now) ELSE r.completed_at END,
    step_reached = CASE
                     WHEN p_event IN ('step', 'complete') AND p_step IS NOT NULL
                       THEN GREATEST(COALESCE(r.step_reached, 0), p_step)
                     ELSE r.step_reached
                   END,
    -- Reagir de novo troca a reação; mandar NULL remove.
    reaction     = CASE WHEN p_event = 'react' THEN p_reaction ELSE r.reaction END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.desk_campaign_track(uuid, text, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.desk_campaign_track(uuid, text, text, integer, text) TO service_role;
