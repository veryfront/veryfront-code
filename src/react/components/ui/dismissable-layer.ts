/**
 * One Escape arbiter per document. Overlay primitives register their live
 * surfaces here so only the visually topmost layer handles an Escape press.
 */

interface DismissableLayer {
  element: () => HTMLElement | null;
  onEscape: (event: KeyboardEvent) => void;
}

interface DocumentLayers {
  layers: DismissableLayer[];
  onKeyDown: (event: KeyboardEvent) => void;
}

const documentLayers = new WeakMap<Document, DocumentLayers>();
const DOCUMENT_POSITION_FOLLOWING = 4;

function topmostLayer(layers: DismissableLayer[]): DismissableLayer | undefined {
  let top: DismissableLayer | undefined;
  let topElement: HTMLElement | null = null;
  for (const layer of layers) {
    const element = layer.element();
    if (!element?.isConnected) continue;
    if (!top || !topElement) {
      top = layer;
      topElement = element;
      continue;
    }
    if (topElement.contains(element)) {
      top = layer;
      topElement = element;
      continue;
    }
    if (element.contains(topElement)) continue;
    if (
      topElement.compareDocumentPosition(element) &
      DOCUMENT_POSITION_FOLLOWING
    ) {
      top = layer;
      topElement = element;
    }
  }
  return top;
}

/** Register a live overlay surface and remove it when the surface closes. */
export function registerDismissableLayer(
  document: Document,
  element: () => HTMLElement | null,
  onEscape: (event: KeyboardEvent) => void,
): () => void {
  let state = documentLayers.get(document);
  if (!state) {
    const layers: DismissableLayer[] = [];
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented || event.key !== "Escape" || event.isComposing ||
        event.keyCode === 229
      ) return;
      const top = topmostLayer(layers);
      if (!top) return;
      event.preventDefault();
      top.onEscape(event);
    };
    state = { layers, onKeyDown };
    documentLayers.set(document, state);
    document.addEventListener("keydown", onKeyDown);
  }

  const layer = { element, onEscape };
  state.layers.push(layer);
  return () => {
    const current = documentLayers.get(document);
    if (!current) return;
    const index = current.layers.lastIndexOf(layer);
    if (index >= 0) current.layers.splice(index, 1);
    if (current.layers.length > 0) return;
    document.removeEventListener("keydown", current.onKeyDown);
    documentLayers.delete(document);
  };
}
