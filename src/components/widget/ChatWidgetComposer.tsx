import { useState, useRef, useCallback, type KeyboardEvent, type ChangeEvent, type DragEvent } from "react";
import { Send, Paperclip, X, ImageIcon } from "lucide-react";

interface Props {
  /** imageData: data URL base64 (opcional) — quando o cliente anexa um print */
  onSend: (message: string, source?: "quick_reply" | "text", imageData?: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_BYTES = 4 * 1024 * 1024;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("read error"));
    reader.readAsDataURL(file);
  });
}

export function ChatWidgetComposer({ onSend, disabled, placeholder }: Props) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const acceptFile = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    setError(null);
    if (!ACCEPTED.includes(file.type)) {
      setError("Formato não suportado. Use PNG, JPG, WebP ou GIF.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Imagem muito grande (máximo 4MB).");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setImage({ dataUrl, name: file.name });
    } catch {
      setError("Não consegui ler a imagem. Tente outra.");
    }
  }, []);

  const handleSend = () => {
    const trimmed = text.trim();
    if ((!trimmed && !image) || disabled) return;
    onSend(trimmed, "text", image?.dataUrl);
    setText("");
    setImage(null);
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (item) {
      e.preventDefault();
      void acceptFile(item.getAsFile());
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    void acceptFile(e.target.files?.[0]);
    e.target.value = ""; // permite re-selecionar o mesmo arquivo
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    void acceptFile(e.dataTransfer.files?.[0]);
  };

  const canSend = (!!text.trim() || !!image) && !disabled;

  return (
    <div
      className="px-3 py-2 border-t border-border bg-card relative"
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {/* Overlay de drag & drop */}
      {dragging && (
        <div className="absolute inset-1 z-10 rounded-lg border-2 border-dashed border-primary bg-primary/10 flex items-center justify-center pointer-events-none">
          <span className="text-xs font-medium text-primary flex items-center gap-1.5">
            <ImageIcon className="h-4 w-4" /> Solte a imagem aqui
          </span>
        </div>
      )}

      {/* Preview da imagem anexada */}
      {image && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted/60 p-1.5 pr-2 w-fit max-w-full">
          <img src={image.dataUrl} alt="anexo" className="h-10 w-10 rounded object-cover shrink-0" />
          <span className="text-[11px] text-muted-foreground truncate max-w-[180px]">{image.name}</span>
          <button
            onClick={() => setImage(null)}
            className="h-5 w-5 rounded-full flex items-center justify-center hover:bg-muted shrink-0"
            aria-label="Remover imagem"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {error && <p className="mb-1.5 text-[11px] text-rose-500">{error}</p>}

      <div className="flex items-end gap-2">
        {/* Anexar imagem */}
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED.join(",")}
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors shrink-0"
          aria-label="Anexar imagem"
          title="Anexar imagem (ou arraste / cole um print)"
        >
          <Paperclip className="h-4 w-4" />
        </button>

        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          onPaste={handlePaste}
          placeholder={placeholder ?? "Digite sua mensagem..."}
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground outline-none py-1.5 min-h-[44px] max-h-40 scrollbar-thin"
          style={{ lineHeight: "1.5" }}
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="h-8 w-8 rounded-md flex items-center justify-center bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors shrink-0"
          aria-label="Enviar mensagem"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
