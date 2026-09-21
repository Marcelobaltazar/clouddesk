import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ACCEPTED_IMAGE_MIMES, uploadKbImage } from "@/lib/kb-images";

interface Props {
  id: string;
  label: string;
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  /** Pasta no bucket (agrupa por disparo). */
  folder: string;
}

/** Imagem do disparo: cola uma URL ou sobe um arquivo (mesmo bucket dos artigos). */
export function ImageField({ id, label, value, onChange, folder }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    const result = await uploadKbImage(file, folder);
    setUploading(false);
    // `=== false` (e não `!ok`): com strictNullChecks desligado o TS só
    // estreita a união pelo discriminante com igualdade explícita.
    if (result.ok === false) {
      toast.error(`Falha ao enviar imagem: ${result.error}`);
      return;
    }
    onChange(result.url);
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder="https://… ou envie um arquivo"
          className="h-9 text-sm"
        />
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_IMAGE_MIMES.join(",")}
          className="hidden"
          onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ""; }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="h-9 shrink-0 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-accent/10 flex items-center gap-1.5 disabled:opacity-60"
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
          {uploading ? "Enviando…" : "Enviar"}
        </button>
      </div>
      {value && (
        <div className="relative inline-block">
          <img src={value} alt="" className="max-h-28 rounded-md border border-border object-cover" />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-card border border-border text-muted-foreground hover:text-rose-500 flex items-center justify-center shadow"
            aria-label="Remover imagem"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
