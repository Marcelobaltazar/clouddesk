import type { CampaignSender } from "@/lib/outbound";

/** Nome que aparece quando o disparo não tem um operador como "rosto". */
export const DEFAULT_SENDER_NAME = "Equipe Cloudfy";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "C";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Avatar do remetente (foto ou iniciais) — sem Radix para não pesar o bundle do widget. */
export function SenderAvatar({ sender, size = 32 }: { sender: CampaignSender | null; size?: number }) {
  const name = sender?.name || DEFAULT_SENDER_NAME;
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) };

  if (sender?.avatar_url) {
    return (
      <img
        src={sender.avatar_url}
        alt={name}
        style={style}
        className="shrink-0 rounded-full object-cover"
        loading="lazy"
      />
    );
  }
  return (
    <span
      style={style}
      className="shrink-0 rounded-full bg-primary text-primary-foreground font-semibold flex items-center justify-center select-none"
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}
