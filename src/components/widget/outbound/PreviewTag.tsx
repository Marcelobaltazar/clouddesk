/** Etiqueta "Prévia": o disparo está sendo mostrado por causa de test_emails,
 *  sem estar no ar — só quem está testando vê. */
export function PreviewTag() {
  return (
    <span className="ml-auto shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-600">
      Prévia
    </span>
  );
}
