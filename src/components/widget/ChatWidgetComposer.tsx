import { useState, useRef, type KeyboardEvent } from "react";
import { Send } from "lucide-react";

interface Props {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatWidgetComposer({ onSend, disabled, placeholder }: Props) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="px-3 py-2 border-t border-border bg-card">
      <div className="flex items-end gap-2">
        {/* Botão de anexo removido: era um no-op (sem handler nem file input).
            Reintroduzir apenas junto com o fluxo real de upload (Storage). */}
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder ?? "Digite sua mensagem..."}
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none py-1.5 max-h-24 scrollbar-thin"
          style={{ lineHeight: "1.5" }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || disabled}
          className="h-8 w-8 rounded-md flex items-center justify-center bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors shrink-0"
          aria-label="Enviar mensagem"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
