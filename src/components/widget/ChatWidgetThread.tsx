import { useEffect, useRef, useState } from "react";
import { Bot, User, KeyRound, Loader2, Check } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import type { WidgetMessage } from "./types";
import { useWidgetStore } from "./useWidgetStore";

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

// ── Markdown rendering for bot bubbles ────────────────────────────────────────
// Tailwind styles applied per element. Bare image URLs in plain text are turned
// into Markdown image syntax first, so they render inline via the `img` renderer.

const IMG_URL_RE = /(https?:\/\/[^\s)]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s)]*)?)/gi;

function linkifyImages(text: string): string {
  // Skip URLs already inside markdown image syntax: ![alt](url)
  return text.replace(IMG_URL_RE, (url, _g, offset, full) => {
    const before = full.slice(Math.max(0, offset - 2), offset);
    if (before === "](") return url; // already part of ![...](url) or [...](url)
    return `![](${url})`;
  });
}

const markdownComponents: Components = {
  p:      ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em:     ({ children }) => <em className="italic">{children}</em>,
  ul:     ({ children }) => <ul className="list-disc ml-4 space-y-1 mb-2 last:mb-0">{children}</ul>,
  ol:     ({ children }) => <ol className="list-decimal ml-4 space-y-1 mb-2 last:mb-0">{children}</ol>,
  a:      ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline opacity-80 hover:opacity-100">
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    // Block code carries a language-* className; inline code does not.
    const isBlock = !!className;
    if (isBlock) {
      return (
        <code className="block bg-black/30 rounded-lg p-3 font-mono text-sm overflow-x-auto">
          {children}
        </code>
      );
    }
    return <code className="bg-white/20 rounded px-1 font-mono text-sm">{children}</code>;
  },
  pre: ({ children }) => <pre className="mb-2 last:mb-0">{children}</pre>,
  img: ({ src, alt }) =>
    typeof src === "string" ? (
      <img src={src} alt={alt ?? ""} loading="lazy" className="max-w-full rounded-lg mt-2" />
    ) : null,
};

function BotMarkdown({ content }: { content: string }) {
  return (
    <div className="text-sm leading-relaxed">
      <ReactMarkdown components={markdownComponents}>{linkifyImages(content)}</ReactMarkdown>
    </div>
  );
}

export function ChatWidgetThread({ messages, conversationId, onSend, onResendCredentials }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { isTyping, isAiResponding } = useWidgetStore();

  // Track which quick-reply groups have been used (one-time use, by message id).
  const [usedQuickReplies, setUsedQuickReplies] = useState<Set<string>>(new Set());

  // Estado dos botões de credenciais, por infra_id: "loading" enquanto envia,
  // "done" após sucesso (some o botão e vira confirmação inline).
  const [credentialState, setCredentialState] = useState<Record<string, "loading" | "done">>({});

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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, isTyping, isAiResponding]);

  // O carregamento de mensagens acontece no ChatWidget (via desk-widget-api,
  // com identidade verificada) — este componente apenas renderiza. O acesso
  // direto a desk_messages foi removido junto com as policies anônimas.

  // ── Render ───────────────────────────────────────────────────────────────────

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const handleQuickReply = (msgId: string, text: string) => {
    setUsedQuickReplies((prev) => new Set(prev).add(msgId));
    onSend(text, "quick_reply");
  };

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin">
      {messages
        .filter((m) => !m.is_private_note)
        .map((msg) => {
          const isContact = msg.sender_type === "contact";
          const isBot     = msg.sender_type === "bot" || msg.ai_generated;
          const isAgent   = msg.sender_type === "agent";
          const isSystem  = msg.sender_type === "system";

          // System messages — centered pill
          if (isSystem) {
            return (
              <div key={msg.id} className="text-center">
                <span className="text-[11px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
                  {msg.content}
                </span>
              </div>
            );
          }

          const quickReplies = msg.metadata?.quick_replies ?? [];
          const showQuickReplies = quickReplies.length > 0 && !usedQuickReplies.has(msg.id);

          // Botões de reenvio de credenciais — um por infra ATIVA (já filtradas
          // no backend). Renderizados em lista vertical, com fundo accent suave.
          const credentialActions = msg.metadata?.credential_actions ?? [];

          return (
            <div
              key={msg.id}
              className={`flex ${isContact ? "justify-end" : "justify-start"} gap-2`}
            >
              {/* Avatar — shown for bot and agent (left side) */}
              {!isContact && (
                <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                  isBot ? "bg-[hsl(var(--bubble-bot))]/20" : "bg-primary/15"
                }`}>
                  {isBot
                    ? <Bot  className="h-3.5 w-3.5 text-[hsl(var(--bubble-bot))]" />
                    : <User className="h-3.5 w-3.5 text-primary" />
                  }
                </div>
              )}

              <div className="max-w-[75%]">
                <div className={`px-3 py-2 rounded-xl text-sm leading-relaxed ${
                  isContact
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : isBot
                    ? "bg-[hsl(var(--bubble-bot))]/15 text-foreground rounded-bl-sm border border-[hsl(var(--bubble-bot))]/20"
                    : "bg-muted text-foreground rounded-bl-sm"
                }`}>
                  {/* IA label */}
                  {isBot && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--bubble-bot))] mb-1 block">
                      <Bot className="h-3 w-3" /> IA
                    </span>
                  )}
                  {/* Human agent label */}
                  {isAgent && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary mb-1 block">
                      <User className="h-3 w-3" /> Suporte
                    </span>
                  )}

                  {/* Imagens anexadas pelo cliente (prints de erro etc.) */}
                  {(msg.metadata?.attachments ?? [])
                    .filter((a) => a.type === "image")
                    .map((a, i) => (
                      <a
                        key={`${msg.id}-img-${i}`}
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block mt-1 first:mt-0"
                      >
                        <img
                          src={a.url}
                          alt="anexo do cliente"
                          loading="lazy"
                          className="max-w-full max-h-52 rounded-lg object-cover"
                        />
                      </a>
                    ))}

                  {/* Bot messages render Markdown + inline images; others stay plain text */}
                  {msg.content && (isBot
                    ? <BotMarkdown content={msg.content} />
                    : <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>

                {/* Quick reply chips — one-time use. Estilo de BOTÃO destacado
                    (fundo claro, texto escuro) para o cliente perceber que é
                    clicável. */}
                {showQuickReplies && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {quickReplies.map((option, i) => (
                      <button
                        key={`${msg.id}-qr-${i}`}
                        onClick={() => handleQuickReply(msg.id, option)}
                        className="rounded-lg bg-slate-100 border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-200 active:scale-[0.98] transition-all"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}

                {/* Botões de reenvio de credenciais — um por infra ativa, em
                    lista vertical, fundo accent suave e cantos arredondados.
                    O disparo só acontece no clique do cliente. */}
                {credentialActions.length > 0 && (
                  <div className="flex flex-col gap-1.5 mt-2">
                    {credentialActions.map((action) => {
                      const state = credentialState[action.infra_id];
                      const isDone = state === "done";
                      const isLoading = state === "loading";
                      return (
                        <button
                          key={`${msg.id}-cred-${action.infra_id}`}
                          onClick={() => handleResendClick(action.infra_id)}
                          disabled={isLoading || isDone}
                          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors disabled:cursor-default ${
                            isDone
                              ? "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30"
                              : "bg-primary/10 text-primary border border-primary/25 hover:bg-primary/20"
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

                <span className="text-[10px] text-muted-foreground mt-0.5 block px-1">
                  {formatTime(msg.created_at)}
                </span>
              </div>
            </div>
          );
        })}

      {/* Typing / AI responding indicator */}
      {(isTyping || isAiResponding) && (
        <div className="flex justify-start gap-2">
          <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
            isAiResponding ? "bg-[hsl(var(--bubble-bot))]/20" : "bg-primary/15"
          }`}>
            {isAiResponding
              ? <Bot  className="h-3.5 w-3.5 text-[hsl(var(--bubble-bot))]" />
              : <User className="h-3.5 w-3.5 text-primary" />
            }
          </div>
          <div className="px-3 py-2.5 rounded-xl bg-muted rounded-bl-sm">
            <div className="flex gap-1 items-center">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
