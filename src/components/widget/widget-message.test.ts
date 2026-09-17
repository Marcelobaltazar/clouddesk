import { describe, it, expect } from "vitest";
import {
  prepareRichMessage,
  needsWideBubble,
  positionsFor,
  dayLabel,
  type GroupableMessage,
} from "./widget-message";

describe("prepareRichMessage", () => {
  it("transforma URL crua em link (a IA manda em texto puro de propósito)", () => {
    const out = prepareRichMessage("Segue a 2ª via: https://faturas.cloudfy.space/abc123");
    expect(out).toContain("[https://faturas.cloudfy.space/abc123](https://faturas.cloudfy.space/abc123)");
  });

  it("deixa a pontuação final fora do endereço", () => {
    const out = prepareRichMessage("Acesse https://cloudfy.space/login.");
    expect(out).toContain("](https://cloudfy.space/login)");
    expect(out).toMatch(/\)\.$/);
  });

  it("não mexe em link que já é markdown", () => {
    const md = "[a central de ajuda](https://clouddesk-omega.vercel.app/ajuda)";
    expect(prepareRichMessage(md)).toBe(md);
  });

  it("URL de imagem vira imagem, não link", () => {
    const out = prepareRichMessage("Veja: https://x.supabase.co/desk-kb-images/a/b.png");
    expect(out).toContain("![](https://x.supabase.co/desk-kb-images/a/b.png)");
    expect(out).not.toContain("[https://x.supabase.co");
  });

  it("isola o vídeo em parágrafo próprio para virar player", () => {
    const out = prepareRichMessage(
      "Veja [este vídeo](https://player.scaleup.com.br/embed/abc123) e me diga.",
    );
    expect(out).toContain("\n\n[este vídeo](https://player.scaleup.com.br/embed/abc123)\n\n");
  });

  it("mantém as três linhas do convite de comunidade separadas", () => {
    const invite = [
      "💬 WhatsApp #1: https://chat.whatsapp.com/AAA",
      "💬 WhatsApp #2: https://chat.whatsapp.com/BBB",
      "🎮 Discord: https://discord.com/invite/CCC",
    ].join("\n");

    const out = prepareRichMessage(invite);
    expect(out.split("\n")).toHaveLength(3);
    expect(out).toContain("](https://chat.whatsapp.com/AAA)");
    expect(out).toContain("](https://discord.com/invite/CCC)");
  });
});

describe("needsWideBubble", () => {
  it("abre a bolha para código, tabela, imagem e vídeo", () => {
    expect(needsWideBubble("```bash\nnpm i\n```")).toBe(true);
    expect(needsWideBubble("| a | b |\n| --- | --- |")).toBe(true);
    expect(needsWideBubble("![print](https://x.com/a.png)")).toBe(true);
    expect(needsWideBubble("[vídeo](https://player.scaleup.com.br/embed/abc)")).toBe(true);
  });

  it("mantém a bolha estreita para texto comum", () => {
    expect(needsWideBubble("Olá! Como posso te ajudar hoje?")).toBe(false);
    expect(needsWideBubble("Veja em [nosso site](https://cloudfy.space)")).toBe(false);
  });
});

describe("positionsFor", () => {
  const at = (minutes: number) => new Date(2026, 8, 16, 10, minutes).toISOString();

  const msg = (
    id: string,
    sender: GroupableMessage["sender_type"],
    minutes: number,
    ai = false,
  ): GroupableMessage => ({ id, sender_type: sender, ai_generated: ai, created_at: at(minutes) });

  it("agrupa mensagens seguidas do mesmo autor", () => {
    const [a, b, c] = positionsFor([
      msg("1", "bot", 0),
      msg("2", "bot", 1),
      msg("3", "contact", 2),
    ]);

    expect(a).toMatchObject({ isFirstOfGroup: true, isLastOfGroup: false });
    expect(b).toMatchObject({ isFirstOfGroup: false, isLastOfGroup: true });
    expect(c).toMatchObject({ isFirstOfGroup: true, isLastOfGroup: true });
  });

  it("quebra o bloco depois de 5 minutos", () => {
    const [a, b] = positionsFor([msg("1", "bot", 0), msg("2", "bot", 6)]);
    expect(a.isLastOfGroup).toBe(true);
    expect(b.isFirstOfGroup).toBe(true);
  });

  it("trata IA e operador como autores diferentes", () => {
    const [, second] = positionsFor([
      msg("1", "agent", 0),
      msg("2", "agent", 1, true), // ai_generated → conta como bot
    ]);
    expect(second.isFirstOfGroup).toBe(true);
  });

  it("mensagem de sistema quebra o bloco dos dois lados", () => {
    const [a, b, c] = positionsFor([
      msg("1", "bot", 0),
      msg("2", "system", 1),
      msg("3", "bot", 2),
    ]);
    expect(a.isLastOfGroup).toBe(true);
    expect(b).toMatchObject({ isFirstOfGroup: true, isLastOfGroup: true });
    expect(c.isFirstOfGroup).toBe(true);
  });

  it("marca a virada do dia", () => {
    const positions = positionsFor([
      { id: "1", sender_type: "bot", ai_generated: false, created_at: new Date(2026, 8, 15, 23, 50).toISOString() },
      { id: "2", sender_type: "bot", ai_generated: false, created_at: new Date(2026, 8, 16, 0, 10).toISOString() },
    ]);
    expect(positions[0].startsNewDay).toBe(true);
    expect(positions[1].startsNewDay).toBe(true);
    // Dias diferentes nunca compartilham bloco.
    expect(positions[1].isFirstOfGroup).toBe(true);
  });
});

describe("dayLabel", () => {
  it("usa 'Hoje' e 'Ontem' antes da data", () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    expect(dayLabel(today.toISOString())).toBe("Hoje");
    expect(dayLabel(yesterday.toISOString())).toBe("Ontem");
  });

  it("escreve a data por extenso nos dias anteriores", () => {
    const old = new Date();
    old.setDate(old.getDate() - 10);
    expect(dayLabel(old.toISOString())).toMatch(/\d{2} de \w+/);
  });
});
