/**
 * Textarea de markdown que aceita mídia:
 *   - imagem colada (Ctrl+V), arrastada ou pelo botão "Anexar imagem";
 *   - vídeo pelo botão "Vídeo" ou colando o código de incorporação.
 *
 * O print vai pro bucket desk-kb-images e o ![alt](url) é inserido na posição do
 * cursor. Enquanto sobe, deixa um placeholder no texto — assim o operador não
 * perde a referência de onde a imagem vai cair se continuar digitando.
 *
 * Vídeo não sobe arquivo: o artigo guarda só o link do player (SmartPlayer,
 * YouTube, Vimeo ou Loom), que a central de ajuda transforma em player.
 */

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Video } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ACCEPTED_IMAGE_MIMES,
  altTextFor,
  isSupportedImage,
  uploadKbImage,
} from "@/lib/kb-images";
import { iframesToMarkdownLinks, isVideoUrl } from "@/lib/help-embeds";

export function MarkdownMediaTextarea({
  value,
  onChange,
  articleId,
  placeholder,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Agrupa as imagens por artigo no Storage. Vazio em artigo novo. */
  articleId?: string | null;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);

  // Espelha o value: dentro do loop de upload (await entre as trocas) a prop
  // ainda é a da renderização antiga, então lemos/escrevemos o texto por aqui.
  const valueRef = useRef(value);
  valueRef.current = value;

  function commit(next: string) {
    valueRef.current = next;
    onChange(next);
  }

  /** Insere um trecho na posição do cursor (ou no fim, se o editor não tem foco). */
  function insertAtCursor(snippet: string) {
    const el = ref.current;
    const start = el ? el.selectionStart : valueRef.current.length;
    const end = el ? el.selectionEnd : valueRef.current.length;
    const next = valueRef.current.slice(0, start) + snippet + valueRef.current.slice(end);
    commit(next);

    const caret = start + snippet.length;
    requestAnimationFrame(() => {
      const node = ref.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(caret, caret);
    });
  }

  async function handleFiles(files: File[]) {
    const images = files.filter(isSupportedImage);
    if (images.length === 0) return;

    const el = ref.current;
    // Sem foco no textarea, anexa no fim do conteúdo.
    let start = el ? el.selectionStart : valueRef.current.length;
    let end = el ? el.selectionEnd : valueRef.current.length;

    for (const file of images) {
      // Placeholder entra na hora para marcar o lugar — o operador pode seguir
      // digitando enquanto o upload roda.
      const token = `![enviando ${altTextFor(file)}...]()`;
      const withToken =
        valueRef.current.slice(0, start) + token + valueRef.current.slice(end);
      commit(withToken);

      setUploading((n) => n + 1);
      const result = await uploadKbImage(file, articleId);
      setUploading((n) => n - 1);

      if (!result.ok) toast.error(`Falha ao enviar imagem: ${result.error}`);
      const markdown = result.ok ? `![${altTextFor(file)}](${result.url})` : "";

      // Localiza o token na hora da troca: o texto pode ter mudado durante o
      // upload (digitação ou outro placeholder inserido).
      const at = valueRef.current.indexOf(token);
      if (at === -1) {
        // Placeholder sumiu (operador apagou). Não reinsere nada.
        if (markdown) toast.info("Imagem enviada, mas o ponto de inserção sumiu");
        continue;
      }
      commit(
        valueRef.current.slice(0, at) + markdown + valueRef.current.slice(at + token.length),
      );
      start = end = at + markdown.length; // próxima imagem entra depois desta
    }

    // Devolve o foco pro editor com o cursor após a última imagem.
    const caret = start;
    requestAnimationFrame(() => {
      const node = ref.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(caret, caret);
    });
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...e.clipboardData.files];
    // Print da tela vem como file no clipboard; se não há imagem, deixa o paste
    // normal de texto acontecer.
    if (files.some(isSupportedImage)) {
      e.preventDefault();
      void handleFiles(files);
      return;
    }

    // Código de incorporação copiado do player: vira link limpo em vez de um
    // <iframe> solto no meio do markdown.
    const text = e.clipboardData.getData("text/plain");
    if (text.includes("<iframe")) {
      e.preventDefault();
      insertAtCursor(`\n${iframesToMarkdownLinks(text).trim()}\n`);
      toast.success("Vídeo inserido");
    }
  }

  function onDrop(e: React.DragEvent<HTMLTextAreaElement>) {
    const files = [...e.dataTransfer.files];
    if (files.some(isSupportedImage)) {
      e.preventDefault();
      setDragging(false);
      void handleFiles(files);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={onPaste}
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          placeholder={placeholder}
          className={cn(
            className,
            dragging && "border-primary ring-1 ring-primary",
          )}
        />
        {dragging && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-primary/10 text-xs font-medium text-primary">
            Solte a imagem para anexar
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_IMAGE_MIMES.join(",")}
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFiles([...(e.target.files ?? [])]);
              e.target.value = ""; // permite reenviar o mesmo arquivo
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => fileRef.current?.click()}
            disabled={uploading > 0}
          >
            {uploading > 0 ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Enviando...</>
            ) : (
              <><ImagePlus className="h-3.5 w-3.5" /> Anexar imagem</>
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setVideoOpen(true)}
          >
            <Video className="h-3.5 w-3.5" /> Vídeo
          </Button>
          <span className="ml-1 text-[10px] text-muted-foreground">
            ou cole (Ctrl+V) o print / o código do vídeo
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground">{value.length} caracteres</p>
      </div>

      <VideoDialog
        open={videoOpen}
        onOpenChange={setVideoOpen}
        onInsert={(snippet) => insertAtCursor(snippet)}
      />
    </div>
  );
}

/** Pede o link (ou o código de incorporação) do vídeo e monta o markdown. */
function VideoDialog({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (snippet: string) => void;
}) {
  const [embed, setEmbed] = useState("");
  const [title, setTitle] = useState("");

  /** Aceita tanto o `<iframe ...>` inteiro quanto só a URL do player. */
  function urlFrom(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;

    if (trimmed.includes("<iframe")) {
      const link = iframesToMarkdownLinks(trimmed).trim();
      return link.match(/\((\S+)\)$/)?.[1] ?? null;
    }
    return /^https?:\/\/\S+$/.test(trimmed) ? trimmed : null;
  }

  function insert() {
    const url = urlFrom(embed);
    if (!url) {
      toast.error("Cole o link do vídeo ou o código de incorporação completo");
      return;
    }
    if (!isVideoUrl(url)) {
      toast.error("Player não reconhecido — use SmartPlayer, YouTube, Vimeo ou Loom");
      return;
    }

    onInsert(`\n\n[${title.trim() || "Vídeo"}](${url})\n\n`);
    setEmbed("");
    setTitle("");
    onOpenChange(false);
    toast.success("Vídeo inserido");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Inserir vídeo</DialogTitle>
          <DialogDescription>
            Cole o código de incorporação do player ou só o link do vídeo. Na central
            de ajuda ele vira um player no meio do artigo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="kb-video-embed">Código de incorporação ou link</Label>
            <Textarea
              id="kb-video-embed"
              value={embed}
              onChange={(e) => setEmbed(e.target.value)}
              rows={4}
              className="font-mono text-xs"
              placeholder={'<iframe src="https://player.scaleup.com.br/embed/..."></iframe>'}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="kb-video-title">Legenda (opcional)</Label>
            <Input
              id="kb-video-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Criar instância no Evolution pela Cloudfy"
            />
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Players aceitos: SmartPlayer, YouTube, Vimeo e Loom. O vídeo continua
            hospedado na plataforma — o artigo guarda só o link.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={insert}>Inserir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
