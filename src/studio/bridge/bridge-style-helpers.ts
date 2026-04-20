export const OVERLAY_STYLE_ELEMENT_ID = "vf-overlay-styles";

export type StyleInjectionWarningContext = {
  error: string;
} | Error;

type StyleDocument = Pick<Document, "createElement" | "getElementById">;

export function hasOverlayStyleElement(documentLike: Pick<Document, "getElementById">): boolean {
  return documentLike.getElementById(OVERLAY_STYLE_ELEMENT_ID) !== null;
}

export function createOverlayStyleElement(
  documentLike: StyleDocument,
  css: string,
): HTMLStyleElement {
  const style = documentLike.createElement("style") as HTMLStyleElement;
  style.id = OVERLAY_STYLE_ELEMENT_ID;
  style.textContent = css;
  return style;
}

export function normalizeStyleInjectionWarningContext(
  error: unknown,
): StyleInjectionWarningContext {
  return error instanceof Error ? error : {
    error: String(error),
  };
}
