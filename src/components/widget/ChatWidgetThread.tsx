/**
 * ChatWidgetThread.tsx — A conversa como o cliente vê.
 *
 * Organização das mensagens:
 *   - mensagens seguidas do mesmo autor viram um bloco (avatar e rótulo só na
 *     primeira, horário só na última) — menos ruído que repetir tudo em cada
 *     bolha;
 *   - cada dia ganha um separador ("Hoje", "Ontem", "12 de setembro");
 *   - IA e operador passam pelo WidgetMarkdown (código, tabela, imagem, vídeo,
 *     link, callout). O texto do CLIENTE é renderizado como texto puro, com os
 *     endereços virando link — nunca interpretado como Markdown, senão um log
 *     colado com `#` ou `*` mudaria de forma sozinho;
 *   - bolha com bloco largo (código, tabela, imagem, vídeo) ocupa a largura
 *     inteira em vez de espremer em 75% do painel.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, User, KeyRound, Loader2, Check } from "lucide-react";
import type { WidgetMessage } from "./types";
import { useWidgetStore } from "./useWidgetStore";
import { WidgetMarkdown } from "./WidgetMarkdown";
import { dayLabel, needsWideBubble, positionsFor, timeLabel } from "./widget-message";

interface Props {
  messages: WidgetMessage[];
  conversationId: string;
  // source 'quick_reply' = clique em chip/botão — o servidor nunca auto-resolve
  // nesses turnos (seleção intermediária não encerra o chamado).
  onSend: (message: string, source?: "quick_reply" | "text") => void;
  // Dispara o reenvio de credenciais de uma infra (clique do cliente no botão).
  // Resolve para true em caso de sucesso. A IA NUNCA chama isto.
  onResendCredentials: (infraId: string) => Promise<boolean>;
}

// ─── Texto do cliente ────────────────────────────────────────────────────────

const URL_RE = /(https?:\/\/[^\s<>()[\]]+)/g;

/**
 * Texto puro com os endereços clicáveis. Preserva as quebras de linha do que o
 * cliente digitou e não interpreta nenhuma marcação.
 *
 * O split com grupo de captura intercala texto e URL, então as posições ímpares
 * são sempre os endereços — mais confiável que testar cada pedaço de novo.
 */
function PlainTextWithLinks({ text }: { text: string }) {
  const parts = useMemo(() => text.split(URL_RE), [text]);

  return (
    <p className="whitespace-pre-wrap text-[13.5px] leading-[1.6] [overflow-wrap:anywhere]">
      {parts.map((part, index) => {
        if (index % 2 === 0) return <span key={index}>{part}</span>;
        // A pontuação final da frase não faz parte do endereço.
        const trailing = part.match(/[.,;:!?]+$/)?.[0] ?? "";
        const href = trailing ? part.slice(0, -trailing.length) : part;
        return (
          <span key={index}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all underline decoration-primary-foreground/50 underline-offset-2 transition-colors hover:decoration-primary-foreground"
            >
              {href}
            </a>
            {trailing}
          </span>
        );
      })}
    </p>
  );
}

// ─── Separador de dia ────────────────────────────────────────────────────────

function DayDivider({ iso }: { iso: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="h-px flex-1 bg-border" />
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {dayLabel(iso)}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

// ─── Thread ──────────────────────────────────────────────────────────────────

export function ChatWidgetThread({ messages, conversationId, onSend, onResendCredentials }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { isTyping, isAiResponding } = useWidgetStore();

  // Track which quick-reply groups have been used (one-time use, by message id).
  const [usedQuickReplies, setUsedQuickReplies] = useState<Set<string>>(new Set());

  // Estado dos botões de credenciais, por infra_id: "loading" enquanto envia,
  // "done" após sucesso (some o botão e vira confirmação inline).
  const [credentialState, setCredentialState] = useState<Record<string, "loading" | "done">>({});

  const visible = useMemo(() => messages.filter((m) => !m.is_private_note), [messages]);
  const positions = useMemo(() => positionsFor(visible), [visible]);

  const handleResendClick = async (infraId: string) => {
    if (credentialState[infraId]) return; // já em andamento ou concluído
    setCredentialState((prev) => ({ ...prev, [infraId]: "loading" }));
    const ok = await onResendCredentials(infraId);
    setCredentialState((prev) => {
      if (ok) return { ...prev, [infraId]: "done" };
      const next = { ...prev };
      delete next[infraId]; // falhou — permite tentar de novo
      return next;
    });
  };

  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const node = scrollRef.current;
    // scrollTo não existe em todo ambiente (jsdom, WebViews antigas): sem a
    // checagem, a thread inteira quebra por causa do scroll.
    if (typeof node?.scrollTo !== "function") return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [messages.length, isTyping, isAiResponding]);

  // O carregamento de mensagens acontece no ChatWidget (via desk-widget-api,
  // com identidade verificada) — este componente apenas renderiza. O acesso
  // direto a desk_messages foi removido junto com as policies anônimas.

  const handleQuickReply = (msgId: string, text: string) => {
    setUsedQuickReplies((prev) => new Set(prev).add(msgId));
    onSend(text, "quick_reply");
  };

  return (
    <div ref={scrollRef} className="flex-1 space-y-1 overflow-y-auto px-4 py-3 scrollbar-thin">
      {visible.map((msg, index) => {
        const { isFirstOfGroup, isLastOfGroup, startsNewDay } = positions[index];

        const isContact = msg.sender_type === "contact";
        const isBot = msg.sender_type === "bot" || msg.ai_generated;
        const isAgent = msg.sender_type === "agent";
        const isSystem = msg.sender_type === "system";

        // System messages — centered pill
        if (isSystem) {
          return (
            <div key={msg.id}>
              {startsNewDay && <DayDivider iso={msg.created_at} />}
              <div className="py-1 text-center">
                <span className="rounded-full bg-muted/60 px-2.5 py-1 text-[11px] text-muted-foreground">
                  {msg.content}
                </span>
              </div>
            </div>
          );
        }

        const quickReplies = msg.metadata?.quick_replies ?? [];
        const showQuickReplies = quickReplies.length > 0 && !usedQuickReplies.has(msg.id);

        // Botões de reenvio de credenciais — um por infra ATIVA (já filtradas
        // no backend). O disparo só acontece no clique do cliente.
        const credentialActions = msg.metadata?.credential_actions ?? [];
        const attachments = (msg.metadata?.attachments ?? []).filter((a) => a.type === "image");

        // Bloco largo espremido em 75% fica ilegível: a bolha abre.
        const wide =
          attachments.length > 0 ||
          ((isBot || isAgent) && needsWideBubble(msg.content ?? ""));

        return (
          <div key={msg.id}>
            {startsNewDay && <DayDivider iso={msg.created_at} />}

            <div
              className={`flex gap-2 ${isContact ? "justify-end" : "justify-start"} ${
                isFirstOfGroup ? "mt-3 first:mt-0" : "mt-0.5"
              }`}
            >
              {/* Avatar só na primeira do bloco; depois, um espaçador do mesmo
                  tamanho mantém as bolhas alinhadas. */}
              {!isContact && (
                isFirstOfGroup ? (
                  <div
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                      isBot ? "bg-[hsl(var(--bubble-bot))]/20" : "bg-primary/15"
                    }`}
                  >
                    {isBot
                      ? <Bot className="h-3.5 w-3.5 text-[hsl(var(--bubble-bot))]" />
                      : <User className="h-3.5 w-3.5 text-primary" />}
                  </div>
                ) : (
                  <div className="h-0 w-7 shrink-0" aria-hidden />
                )
              )}

              <div className={wide ? "min-w-0 flex-1" : "min-w-0 max-w-[80%]"}>
                <div
                  className={`min-w-0 overflow-hidden rounded-xl px-3 py-2 ${
                    isContact
                      ? `bg-primary text-primary-foreground ${isLastOfGroup ? "rounded-br-sm" : ""}`
                      : isBot
                      // Opacidade cheia: --bubble-bot já É a cor da bolha (azul claro
                      // no tema claro). A 15% ela sumia contra o painel branco.
                      ? `bg-[hsl(var(--bubble-bot))] text-[hsl(var(--bubble-bot-foreground))] ${isLastOfGroup ? "rounded-bl-sm" : ""}`
                      : `bg-muted text-foreground ${isLastOfGroup ? "rounded-bl-sm" : ""}`
                  }`}
                >
                  {/* Rótulo do autor — só abrindo o bloco. */}
                  {isFirstOfGroup && isBot && (
                    <span className="mb-1 flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--bubble-bot))]">
                      <Bot className="h-3 w-3" /> IA
                    </span>
                  )}
                  {isFirstOfGroup && isAgent && (
                    <span className="mb-1 flex items-center gap-1 text-[10px] font-medium text-primary">
                      <User className="h-3 w-3" /> Suporte
                    </span>
                  )}

                  {/* Imagens anexadas (prints de erro etc.).
                      object-contain: cortar o print esconde justamente o erro.
                      A margem negativa encosta a imagem na borda da bolha — só
                      sobe até o topo quando não há rótulo de autor acima. */}
                  {attachments.length > 0 && (
                    <div
                      className={`-mx-3 space-y-1 ${msg.content ? "mb-2" : ""} ${
                        isFirstOfGroup && (isBot || isAgent) ? "" : "-mt-2"
                      }`}
                    >
                      {attachments.map((a, i) => (
                        <a
                          key={`${msg.id}-img-${i}`}
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <img
                            src={a.url}
                            alt="Imagem anexada à mensagem"
                            loading="lazy"
                            className="max-h-64 w-full bg-black/10 object-contain transition-opacity hover:opacity-90"
                          />
                        </a>
                      ))}
                    </div>
                  )}

                  {msg.content && (isBot || isAgent
                    ? <WidgetMarkdown content={msg.content} />
                    : <PlainTextWithLinks text={msg.content} />
                  )}
                </div>

                {/* Quick replies — uso único. Estilo de BOTÃO destacado para o
                    cliente perceber que é clicável. */}
                {showQuickReplies && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {quickReplies.map((option, i) => (
                      <button
                        key={`${msg.id}-qr-${i}`}
                        onClick={() => handleQuickReply(msg.id, option)}
                        className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-[13px] font-medium text-slate-900 shadow-sm transition-all hover:bg-slate-200 active:scale-[0.98]"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}

                {/* Reenvio de credenciais — um botão por infra ativa. */}
                {credentialActions.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {credentialActions.map((action) => {
                      const state = credentialState[action.infra_id];
                      const isDone = state === "done";
                      const isLoading = state === "loading";
                      return (
                        <button
                          key={`${msg.id}-cred-${action.infra_id}`}
                          onClick={() => handleResendClick(action.infra_id)}
                          disabled={isLoading || isDone}
                          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors disabled:cursor-default ${
                            isDone
                              ? "border border-emerald-500/30 bg-emerald-500/15 text-emerald-600"
                              : "border border-primary/25 bg-primary/10 text-primary hover:bg-primary/20"
                          }`}
                        >
                          {isDone
                            ? <Check className="h-4 w-4 shrink-0" />
                            : isLoading
                            ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                            : <KeyRound className="h-4 w-4 shrink-0" />}
                          <span className="flex-1">
                            {isDone
                              ? `Credenciais enviadas — ${action.label}`
                              : `Reenviar minhas credenciais — ${action.label}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Horário só fechando o bloco. */}
                {isLastOfGroup && (
                  <span
                    className={`mt-0.5 block px-1 text-[10px] text-muted-foreground ${
                      isContact ? "text-right" : ""
                    }`}
                  >
                    {timeLabel(msg.created_at)}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Typing / AI responding indicator */}
      {(isTyping || isAiResponding) && (
        <div className="flex justify-start gap-2 pt-2">
          <div
            className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
              isAiResponding ? "bg-[hsl(var(--bubble-bot))]/20" : "bg-primary/15"
            }`}
          >
            {isAiResponding
              ? <Bot className="h-3.5 w-3.5 text-[hsl(var(--bubble-bot))]" />
              : <User className="h-3.5 w-3.5 text-primary" />}
          </div>
          <div className="rounded-xl rounded-bl-sm bg-muted px-3 py-2.5">
            <div className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: "0ms" }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: "150ms" }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
