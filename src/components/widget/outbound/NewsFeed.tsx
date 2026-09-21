import { useEffect, useRef } from "react";
import { Compass, Newspaper, Play, CheckCircle2 } from "lucide-react";
import { useWidgetStore } from "../useWidgetStore";
import { NewsCard } from "./NewsCard";
import {
  selectNews,
  selectListedTours,
  trackCampaign,
  type TourCampaign,
} from "./useOutbound";

interface Props {
  /** Inicia um tour guiado (fecha o widget e roda na página). */
  onStartTour: (tour: TourCampaign) => void;
}

/**
 * Feed de Novidades — a aba "News" do Messenger. Histórico completo do que a
 * Cloudfy já anunciou, mais recente primeiro, e os tours guiados disponíveis.
 */
export function NewsFeed({ onStartTour }: Props) {
  const campaigns = useWidgetStore((s) => s.campaigns);
  const loaded = useWidgetStore((s) => s.campaignsLoaded);
  const news = selectNews(campaigns);
  const tours = selectListedTours(campaigns);

  // Abrir o feed = viu tudo que está listado. É a "impressão" da novidade:
  // o card apareceu na tela do cliente. (Clique no link é evento à parte.)
  // A chave só muda quando entra novidade nova ou não lida — trackCampaign
  // marca o receipt local na hora, então nada é contado duas vezes.
  const unseenKey = news.filter((n) => !n.receipt?.seen).map((n) => n.id).join(",");
  // O ponto de "não lida" fica enquanto o feed está aberto, mesmo depois de
  // marcada como vista — senão ele sumiria no mesmo instante em que aparece.
  const newThisVisit = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const id of unseenKey.split(",").filter(Boolean)) {
      newThisVisit.current.add(id);
      trackCampaign(id, "seen");
    }
  }, [unseenKey]);

  const isEmpty = loaded && news.length === 0 && tours.length === 0;

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin bg-muted/30">
      {!loaded ? (
        <div className="p-3 space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-3.5 space-y-2">
              <div className="h-2.5 w-16 bg-muted rounded animate-pulse" />
              <div className="h-3.5 w-3/4 bg-muted rounded animate-pulse" />
              <div className="h-2.5 w-full bg-muted rounded animate-pulse" />
              <div className="h-2.5 w-5/6 bg-muted rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : isEmpty ? (
        <div className="h-full flex flex-col items-center justify-center px-6 text-center gap-3">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Newspaper className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Nenhuma novidade ainda</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Quando lançarmos algo novo, você fica sabendo por aqui.
            </p>
          </div>
        </div>
      ) : (
        <div className="p-3 space-y-3">
          {tours.length > 0 && (
            <section className="space-y-2">
              <h4 className="flex items-center gap-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Compass className="h-3.5 w-3.5" /> Tours guiados
              </h4>
              {tours.map((tour) => {
                const done = !!tour.receipt?.completed;
                const first = tour.content.steps[0];
                return (
                  <div
                    key={tour.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-foreground truncate">
                        {first?.title || "Tour guiado"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {tour.content.steps.length} {tour.content.steps.length === 1 ? "passo" : "passos"}
                        {done && " · concluído"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onStartTour(tour)}
                      className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all duration-150 ${
                        done
                          ? "border border-border text-foreground hover:bg-accent/10"
                          : "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]"
                      }`}
                    >
                      {done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Play className="h-3.5 w-3.5" />}
                      {done ? "Rever" : "Iniciar"}
                    </button>
                  </div>
                );
              })}
            </section>
          )}

          {news.length > 0 && (
            <section className="space-y-3">
              {tours.length > 0 && (
                <h4 className="flex items-center gap-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Newspaper className="h-3.5 w-3.5" /> Novidades
                </h4>
              )}
              {news.map((item) => (
                <NewsCard
                  key={item.id}
                  content={item.content}
                  publishedAt={item.published_at}
                  unread={!item.receipt?.seen || newThisVisit.current.has(item.id)}
                  isTest={item.is_test}
                  reaction={item.receipt?.reaction ?? null}
                  onLink={() => {
                    trackCampaign(item.id, "click");
                    if (item.content.link_url) window.open(item.content.link_url, "_blank", "noopener,noreferrer");
                  }}
                  onReact={(reaction) => trackCampaign(item.id, "react", { reaction })}
                />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
