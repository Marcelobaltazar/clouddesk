// Sinal cross-component para a sidebar recarregar as Visualizações assim que
// o operador cria/edita/remove/reordena uma view em Configurações — sem reload.

export const VIEWS_CHANGED_EVENT = "clouddesk:views-changed";

/** Dispara o evento de mudança de visualizações (chamado após CRUD em Settings). */
export function notifyViewsChanged(): void {
  window.dispatchEvent(new CustomEvent(VIEWS_CHANGED_EVENT));
}
