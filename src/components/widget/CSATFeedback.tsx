import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWidgetStore } from "./useWidgetStore";

interface Props {
  conversationId?: string | null;
  /** auth user id do cliente no Supabase de produção da Cloudfy (embedUser.id) */
  accountUserId?: string | null;
}

export function CSATFeedback({ conversationId, accountUserId }: Props) {
  const { setCsatSubmitted, setShowCsat } = useWidgetStore();
  const [selected, setSelected] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const emojis = [
    { value: 1, emoji: "😞", label: "Ruim" },
    { value: 2, emoji: "😐", label: "Regular" },
    { value: 3, emoji: "😊", label: "Ótimo" },
  ];

  const handleSubmit = async () => {
    if (selected === null || saving) return;
    setSaving(true);

    // account_user_id é NOT NULL no schema — usa o id do cliente na Cloudfy.
    // Falha de gravação não bloqueia o agradecimento (UX primeiro, métrica depois).
    if (conversationId && accountUserId) {
      const { error } = await supabase.from("desk_csat").insert({
        conversation_id: conversationId,
        account_user_id: accountUserId,
        rating: selected,
        comment: comment.trim() || null,
      });
      if (error) console.warn("[CSAT] Falha ao salvar avaliação:", error.message);
    } else {
      console.warn("[CSAT] Sem conversationId/accountUserId — avaliação não persistida");
    }

    setSaving(false);
    setSubmitted(true);
    setCsatSubmitted(true);
    setTimeout(() => setShowCsat(false), 2000);
  };

  if (submitted) {
    return (
      <div className="p-4 text-center">
        <p className="text-sm font-medium text-foreground">Obrigado pelo feedback! 🎉</p>
      </div>
    );
  }

  return (
    <div className="p-4 border-t border-border bg-card">
      <p className="text-sm font-medium text-foreground mb-3 text-center">
        Como foi o atendimento?
      </p>
      <div className="flex justify-center gap-4 mb-3">
        {emojis.map((e) => (
          <button
            key={e.value}
            onClick={() => setSelected(e.value)}
            className={`flex flex-col items-center gap-1 transition-all duration-150 ${
              selected === e.value ? "scale-110" : "opacity-60 hover:opacity-100"
            }`}
          >
            <span className="text-2xl">{e.emoji}</span>
            <span className="text-[10px] text-muted-foreground">{e.label}</span>
          </button>
        ))}
      </div>
      {selected !== null && (
        <>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Comentário opcional..."
            rows={2}
            className="w-full bg-muted rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground resize-none outline-none mb-2"
          />
          <button
            onClick={handleSubmit}
            className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            Enviar avaliação
          </button>
        </>
      )}
    </div>
  );
}
