/**
 * CampaignPreview.tsx — Prévia ao vivo de um disparo, do jeito que o cliente vê.
 *
 * Não é uma imitação: os cards são os MESMOS componentes que o widget usa
 * (NoticeCard, BannerStrip, NewsCard, TourCard), dentro de uma moldura que
 * reproduz o bubble (fechado ou aberto) e a página do host. O `data-theme=
 * "light"` força a paleta clara — o site do host não tem tema escuro.
 */

import { useState } from "react";
import { ChevronLeft, ChevronRight, MessageCircle, MessagesSquare, Newspaper, Minus, Bot, User } from "lucide-react";
import type { CampaignContent, CampaignSender, CampaignType, NoticeContent, NewsContent, BannerContent, TourContent } from "@/lib/outbound";
import { NoticeCard } from "@/components/widget/outbound/NoticeCard";
import { BannerStrip } from "@/components/widget/outbound/BannerStrip";
import { NewsCard } from "@/components/widget/outbound/NewsCard";
import { TourCard, TourFinishCard } from "@/components/widget/outbound/TourCard";
import { cn } from "@/lib/utils";

interface Props {
  type: CampaignType;
  content: CampaignContent;
  sender: CampaignSender | null;
  /** Tour: passo exibido (controlado pelo editor, que destaca o passo em edição). */
  stepIndex?: number;
  onStepIndexChange?: (index: number) => void;
  className?: string;
}

export function CampaignPreview({ type, content, sender, stepIndex = 0, onStepIndexChange, className }: Props) {
  const [noticeMode, setNoticeMode] = useState<"closed" | "open">("closed");
  const [bannerMode, setBannerMode] = useState<"open" | "closed">("open");

  return (
    <div className={cn("space-y-2", className)}>
      {type === "notice" && (
        <ModeToggle<"closed" | "open">
          value={noticeMode}
          onChange={setNoticeMode}
          options={[
            { value: "closed", label: "Widget fechado" },
            { value: "open", label: "Widget aberto" },
          ]}
          hint={(content as NoticeContent).display === "card" && noticeMode === "closed"
            ? "Este aviso está como \"só dentro do widget\" — com o widget fechado ele não aparece."
            : undefined}
        />
      )}
      {type === "banner" && (
        <ModeToggle<"open" | "closed">
          value={bannerMode}
          onChange={setBannerMode}
          options={[
            { value: "open", label: "Widget aberto" },
            { value: "closed", label: "Widget fechado" },
          ]}
          hint={bannerMode === "closed" && !(content as BannerContent).show_when_closed
            ? "Ative \"mostrar com o widget fechado\" para o banner aparecer aqui."
            : undefined}
        />
      )}

      <div
        data-theme="light"
        className="relative h-[560px] overflow-hidden rounded-2xl border border-border bg-[#eef0ea] text-foreground shadow-inner"
      >
        <PageMock tourStep={type === "tour" ? (content as TourContent).steps[stepIndex] : undefined} />

        {type === "notice" && noticeMode === "closed" && (
          <ClosedState>
            {(content as NoticeContent).display === "popup" && (
              <div className="w-[300px]">
                <NoticeCard content={content as NoticeContent} sender={sender} variant="popup" onCta={() => {}} onDismiss={() => {}} />
              </div>
            )}
          </ClosedState>
        )}
        {type === "notice" && noticeMode === "open" && (
          <WidgetFrame title="Meus chamados" tab="list">
            <div className="p-3 space-y-2 border-b border-border/60 bg-muted/20">
              <NoticeCard content={content as NoticeContent} sender={sender} variant="card" onCta={() => {}} onDismiss={() => {}} />
            </div>
            <FakeConversations />
          </WidgetFrame>
        )}

        {type === "news" && (
          <WidgetFrame title="Novidades" tab="news">
            <div className="p-3 bg-muted/30 min-h-full">
              <NewsCard content={content as NewsContent} publishedAt={new Date().toISOString()} unread reaction={null} onLink={() => {}} onReact={() => {}} />
            </div>
          </WidgetFrame>
        )}

        {type === "banner" && bannerMode === "open" && (
          <WidgetFrame title="Meus chamados" tab="list" banner={<BannerStrip content={content as BannerContent} onCta={() => {}} onDismiss={() => {}} />}>
            <FakeConversations />
          </WidgetFrame>
        )}
        {type === "banner" && bannerMode === "closed" && (
          <ClosedState>
            {(content as BannerContent).show_when_closed && (
              <div className="w-[300px]">
                <BannerStrip content={content as BannerContent} variant="pill" onCta={() => {}} onDismiss={() => {}} />
              </div>
            )}
          </ClosedState>
        )}

        {type === "tour" && (
          <TourPreview content={content as TourContent} stepIndex={stepIndex} onStepIndexChange={onStepIndexChange} />
        )}
      </div>
    </div>
  );
}

// ─── Molduras ────────────────────────────────────────────────────────────────

function ModeToggle<T extends string>({ value, onChange, options, hint }: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md px-2.5 py-1 font-medium transition-colors",
              value === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && <p className="text-[11px] text-amber-600">{hint}</p>}
    </div>
  );
}

/** Fundo que imita a área logada do cliente (barra, cards, linhas de texto). */
function PageMock({ tourStep }: { tourStep?: { selector: string; title: string } }) {
  return (
    <div className="absolute inset-0 p-4 select-none" aria-hidden="true">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-6 w-6 rounded-md bg-slate-800/80" />
        <div className="h-3 w-24 rounded bg-slate-800/30" />
        <div className="ml-auto flex gap-2">
          <div className="h-6 w-14 rounded-md bg-slate-800/15" />
          <div id="cd-preview-target" className={cn("h-6 w-16 rounded-md bg-slate-800/15", tourStep && "ring-2 ring-primary bg-primary/20")} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-white/70 border border-slate-800/10" />
        ))}
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-2.5 w-3/4 rounded bg-slate-800/15" />
        <div className="h-2.5 w-2/3 rounded bg-slate-800/15" />
        <div className="h-2.5 w-1/2 rounded bg-slate-800/15" />
      </div>
    </div>
  );
}

/** Estado fechado: só a bolha no canto e o que flutua acima dela. */
function ClosedState({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="absolute bottom-[84px] right-4">{children}</div>
      <div className="absolute bottom-4 right-4 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center">
        <MessageCircle className="h-6 w-6" />
      </div>
    </>
  );
}

/** Moldura do widget aberto: header, banner opcional, conteúdo, abas e rodapé. */
function WidgetFrame({ title, tab, banner, children }: {
  title: string;
  tab: "list" | "news";
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="absolute bottom-4 right-4 w-[340px] h-[500px] rounded-xl shadow-2xl border border-border bg-card flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-primary text-primary-foreground">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-8 w-8 shrink-0 rounded-full bg-primary-foreground/20 flex items-center justify-center text-sm font-bold">CD</div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{title}</h3>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-[11px] opacity-80">2 atendentes online</span>
            </div>
          </div>
        </div>
        <Minus className="h-4 w-4 opacity-80" />
      </div>
      {banner}
      <div className="flex-1 overflow-y-auto scrollbar-thin">{children}</div>
      <nav className="grid grid-cols-2 border-t border-border bg-card">
        {[
          { key: "list", label: "Chamados", icon: MessagesSquare },
          { key: "news", label: "Novidades", icon: Newspaper },
        ].map(({ key, label, icon: Icon }) => (
          <div
            key={key}
            className={cn(
              "relative flex flex-col items-center gap-0.5 py-2 text-[10.5px] font-medium",
              tab === key ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="h-[18px] w-[18px]" />
            {label}
            {tab === key && <span className="absolute top-0 inset-x-6 h-0.5 rounded-b bg-primary" />}
          </div>
        ))}
      </nav>
      <div className="px-3 py-1.5 border-t border-border bg-muted/30">
        <p className="text-[10px] text-muted-foreground text-center">
          Powered by <span className="font-semibold">CloudDesk</span>
        </p>
      </div>
    </div>
  );
}

function FakeConversations() {
  const rows = [
    { icon: Bot, subject: "Meu n8n não está abrindo", preview: "Você: Já tentei reiniciar…", when: "há 2h", status: "Em aberto" },
    { icon: User, subject: "Dúvida sobre upgrade", preview: "Suporte: Claro! O plano Ultra…", when: "ontem", status: "Resolvido" },
  ];
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} className="px-4 py-3 flex gap-3 border-b border-border/60">
          <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
            <r.icon className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate text-sm font-medium text-foreground/90">{r.subject}</span>
              <span className="text-[10px] text-muted-foreground">{r.when}</span>
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{r.preview}</p>
            <span className="inline-block mt-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">{r.status}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Tour ────────────────────────────────────────────────────────────────────

function TourPreview({ content, stepIndex, onStepIndexChange }: {
  content: TourContent;
  stepIndex: number;
  onStepIndexChange?: (index: number) => void;
}) {
  const total = content.steps.length;
  const [showFinish, setShowFinish] = useState(false);
  const step = content.steps[Math.min(stepIndex, Math.max(0, total - 1))];

  if (total === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Adicione o primeiro passo para ver a prévia.
      </div>
    );
  }

  return (
    <>
      {/* Escurecimento com "recorte" no elemento de exemplo (canto superior direito do mock). */}
      <div className="absolute inset-0 bg-[#0f1117]/55" />
      {!showFinish && step?.selector && (
        <div className="absolute top-[10px] right-[10px] h-[36px] w-[76px] rounded-lg ring-2 ring-primary bg-white/90 animate-pulse" />
      )}

      <div className={cn("absolute", !showFinish && step?.selector ? "top-[60px] right-3" : "inset-0 flex items-center justify-center p-3")}>
        {showFinish && content.finish_message?.trim() ? (
          <TourFinishCard message={content.finish_message} onClose={() => setShowFinish(false)} />
        ) : (
          <TourCard
            step={step}
            index={stepIndex}
            total={total}
            showProgress={content.show_progress}
            arrow={step?.selector ? "top" : null}
            onPrev={stepIndex > 0 ? () => onStepIndexChange?.(stepIndex - 1) : undefined}
            onNext={() => {
              if (stepIndex >= total - 1) {
                if (content.finish_message?.trim()) setShowFinish(true);
                else onStepIndexChange?.(0);
              } else onStepIndexChange?.(stepIndex + 1);
            }}
            onSkip={() => onStepIndexChange?.(0)}
          />
        )}
      </div>

      {/* Navegador de passos da prévia */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-card/95 border border-border px-2 py-1 text-[11px] text-muted-foreground shadow">
        <button type="button" className="h-6 w-6 rounded-full hover:bg-accent/20 flex items-center justify-center disabled:opacity-40" disabled={stepIndex <= 0} onClick={() => { setShowFinish(false); onStepIndexChange?.(stepIndex - 1); }} aria-label="Passo anterior">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="tabular-nums px-1">Passo {Math.min(stepIndex + 1, total)} de {total}</span>
        <button type="button" className="h-6 w-6 rounded-full hover:bg-accent/20 flex items-center justify-center disabled:opacity-40" disabled={stepIndex >= total - 1} onClick={() => { setShowFinish(false); onStepIndexChange?.(stepIndex + 1); }} aria-label="Próximo passo">
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </>
  );
}
