import { useState } from "react";
import { ExternalLink, ChevronDown } from "lucide-react";
import { NEWS_TAG_LABELS, REACTIONS, type NewsContent, type NewsTag } from "@/lib/outbound";
import { WidgetMarkdown } from "../WidgetMarkdown";
import { PreviewTag } from "./PreviewTag";

interface Props {
  content: NewsContent;
  publishedAt: string | null;
  unread?: boolean;
  isTest?: boolean;
  reaction?: string | null;
  onLink?: () => void;
  onReact?: (reaction: string | null) => void;
}

const TAG_STYLES: Record<NewsTag, string> = {
  novo: "bg-primary/12 text-primary",
  melhoria: "bg-emerald-500/12 text-emerald-700",
  correcao: "bg-amber-500/15 text-amber-700",
  anuncio: "bg-violet-500/12 text-violet-700",
};

/** "21 de set" / "3 de jan de 2025" — data curta, sem hora (novidade não tem urgência). */
export function formatNewsDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("pt-BR", sameYear
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" });
}

/** Texto longo começa recolhido: o feed é para passar o olho; quem quer, abre. */
const COLLAPSE_AFTER_CHARS = 280;

/**
 * Card de Novidade — o "News item" do Intercom. Puro: widget e prévia do editor.
 */
export function NewsCard({ content, publishedAt, unread, isTest, reaction, onLink, onReact }: Props) {
  const isLong = content.body.length > COLLAPSE_AFTER_CHARS;
  const [expanded, setExpanded] = useState(!isLong);
  const tag = content.tag ?? null;

  return (
    <article className="relative rounded-xl border border-border bg-card overflow-hidden">
      {unread && (
        <span
          className="absolute top-3 right-3 h-2 w-2 rounded-full bg-primary ring-2 ring-card"
          aria-label="Não lida"
        />
      )}

      {content.image_url && (
        <img src={content.image_url} alt="" className="w-full max-h-44 object-cover" loading="lazy" />
      )}

      <div className="p-3.5">
        <div className="flex items-center gap-2 mb-1.5">
          {tag && (
            <span className={`rounded-full px-2 py-px text-[10px] font-semibold ${TAG_STYLES[tag] ?? TAG_STYLES.novo}`}>
              {NEWS_TAG_LABELS[tag] ?? tag}
            </span>
          )}
          <span className="text-[10.5px] text-muted-foreground">{formatNewsDate(publishedAt)}</span>
          {isTest && <PreviewTag />}
        </div>

        <h4 className="text-[14px] font-semibold text-foreground leading-snug mb-1.5 pr-4">
          {content.title}
        </h4>

        <div
          className={`relative text-foreground/90 ${expanded ? "" : "max-h-24 overflow-hidden"}`}
        >
          <WidgetMarkdown content={content.body} />
          {!expanded && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" />
          )}
        </div>
        {!expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
          >
            Ler tudo <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )}

        {(content.link_url || content.allow_reactions) && (
          <div className="mt-3 flex items-center justify-between gap-2">
            {content.link_url ? (
              <button
                type="button"
                onClick={onLink}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] font-medium text-foreground hover:border-primary/40 hover:bg-accent/10 transition-colors duration-150"
              >
                {content.link_label?.trim() || "Saiba mais"}
                <ExternalLink className="h-3 w-3 opacity-70" />
              </button>
            ) : <span />}

            {content.allow_reactions && (
              <div className="flex items-center gap-1" role="group" aria-label="Reagir">
                {REACTIONS.map((emoji) => {
                  const active = reaction === emoji;
                  return (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => onReact?.(active ? null : emoji)}
                      aria-pressed={active}
                      title={active ? "Remover reação" : "Reagir"}
                      className={`h-7 w-7 rounded-full text-[14px] leading-none flex items-center justify-center transition-all duration-150 ${
                        active
                          ? "bg-primary/15 ring-1 ring-primary/40 scale-110"
                          : "hover:bg-accent/15 opacity-70 hover:opacity-100"
                      }`}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
