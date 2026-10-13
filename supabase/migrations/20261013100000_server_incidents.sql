-- ─── Incidentes de servidor (Bloco 2) ───────────────────────────────────────────
-- Quando a IA confirma que o servidor de um cliente não responde (Portainer fora
-- em todas as tentativas, servidor de controle respondendo), abre-se UM
-- incidente por servidor e cada conversa afetada é ligada a ele. O painel mostra
-- o alerta e o operador confirma o reinício (modo sombra). Depois, o monitor
-- testa de novo e avisa os clientes quando voltar.
--
-- Dados internos: nome do servidor e URL do Portainer ficam aqui, visíveis só a
-- operadores — nunca ao widget nem ao texto da IA.
-- Escrita só pelas Edge Functions (service role); operadores apenas leem.

CREATE TABLE IF NOT EXISTS public.desk_server_incidents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id          integer NOT NULL,      -- servers.id no banco da Cloudfy (vínculo lógico)
  server_name        text NOT NULL,         -- server-portainer-live-{N}
  portainer_url      text NOT NULL,         -- https://portainer{N}.cloudfy.live
  status             text NOT NULL DEFAULT 'detected'
                     CHECK (status IN ('detected', 'restart_sent', 'recovered', 'unresolved', 'dismissed')),
  detected_at        timestamptz NOT NULL DEFAULT now(),
  restart_mode       text CHECK (restart_mode IN ('manual', 'auto')),
  restart_requested_by uuid,                -- auth.users.id do operador (null = automático)
  restart_sent_at    timestamptz,
  restart_error      text,
  resolved_at        timestamptz,
  last_check_at      timestamptz,
  last_check_ok      boolean,
  evidence           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- tentativas e controles do teste
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- No máximo UM incidente aberto por servidor: o segundo cliente do mesmo
-- servidor entra no incidente que já existe, sem disparar outro reinício.
CREATE UNIQUE INDEX IF NOT EXISTS desk_server_incidents_one_open
  ON public.desk_server_incidents (server_id)
  WHERE status IN ('detected', 'restart_sent');

CREATE INDEX IF NOT EXISTS desk_server_incidents_recent
  ON public.desk_server_incidents (detected_at DESC);

CREATE TABLE IF NOT EXISTS public.desk_server_incident_conversations (
  incident_id     uuid NOT NULL REFERENCES public.desk_server_incidents(id),
  conversation_id uuid NOT NULL REFERENCES public.desk_conversations(id),
  infra_name      text,
  linked_at       timestamptz NOT NULL DEFAULT now(),
  notified_at     timestamptz,             -- quando o cliente recebeu o aviso de "voltou"
  PRIMARY KEY (incident_id, conversation_id)
);

ALTER TABLE public.desk_server_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desk_server_incident_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS desk_server_incidents_agents_read ON public.desk_server_incidents;
CREATE POLICY desk_server_incidents_agents_read ON public.desk_server_incidents
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.desk_agents WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS desk_server_incident_conversations_agents_read ON public.desk_server_incident_conversations;
CREATE POLICY desk_server_incident_conversations_agents_read ON public.desk_server_incident_conversations
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.desk_agents WHERE auth_user_id = auth.uid()));

-- O painel recebe o alerta na hora (Realtime respeita a RLS acima).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'desk_server_incidents'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.desk_server_incidents;
  END IF;
END $$;
