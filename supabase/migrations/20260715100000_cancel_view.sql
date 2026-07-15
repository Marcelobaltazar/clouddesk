-- ─── View "Cancelamentos" (painel P8) ────────────────────────────────────────
--
-- O guard determinístico de cancelamento (ai-pipeline) escala para humano todo
-- cliente que NÃO CONSEGUE cancelar (ou insiste), marca a conversa com a tag
-- intent:cancelamento (via applyAnalysis) e promete retorno em até 12h.
-- Esta view dá visibilidade imediata a esses casos na sidebar do painel.
--
-- filters.tag é o filtro genérico por tag suportado pelo AppSidebar
-- (tem precedência sobre o filtro de plano).

INSERT INTO public.desk_views (name, emoji, color, order_index, filters, is_active)
SELECT
  'Cancelamentos',
  '🚨',
  '#f43f5e',
  0,  -- primeiro da lista: prioridade máxima de atenção
  '{"tag": "intent:cancelamento"}'::jsonb,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.desk_views WHERE name = 'Cancelamentos'
);
