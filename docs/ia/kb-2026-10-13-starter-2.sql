-- Política do Starter, parte 2 (13/10/2026): o que só a equipe executa chega a
-- ela em qualquer plano (senha do n8n, backup, credencial da IA Ilimitada,
-- reembolso…). Complementa kb-2026-10-13-starter.sql.
-- Aplicar: npx supabase db query --linked -f docs/ia/kb-2026-10-13-starter-2.sql
-- Depois:  npx tsx scripts/reindex-kb.ts --pending
-- Desfazer as duas partes: docs/ia/kb-2026-10-13-starter-rollback.sql
do $$
declare n int;
begin
  update desk_knowledge_base
     set content = replace(content,
           $o$O atendimento da equipe é dos planos **Advanced, Ultra e Max**.$o$,
           $n$O atendimento da equipe é dos planos **Advanced, Ultra e Max** — fora os pedidos que só a equipe consegue executar (como resetar a senha do n8n, restaurar um backup ou analisar um reembolso), que chegam a ela em qualquer plano.$n$),
         updated_at = now()
   where id = '37da2e2c-9da0-471d-94c2-b4ccdea47b36'
     and position($o$O atendimento da equipe é dos planos **Advanced, Ultra e Max**.$o$ in content) > 0;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'artigo SLA & Suporte: texto esperado não encontrado (% linhas)', n; end if;

  update desk_ai_snippets
     set content = replace(content,
           $o$O atendimento da equipe é dos planos Advanced, Ultra e Max.$o$,
           $n$O atendimento da equipe é dos planos Advanced, Ultra e Max — fora os pedidos que só a equipe consegue executar (como resetar a senha do n8n, restaurar um backup ou analisar um reembolso), que chegam a ela em qualquer plano.$n$)
   where id = '9aa95e75-6e86-474e-8ce0-1a4adfa6a176'
     and position($o$O atendimento da equipe é dos planos Advanced, Ultra e Max.$o$ in content) > 0;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'snippet Como falo com o suporte: texto esperado não encontrado (% linhas)', n; end if;
end $$;
