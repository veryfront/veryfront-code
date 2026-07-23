export const OVERLAY_STYLE_ELEMENT_ID = "vf-overlay-styles";
export const OVERLAY_STYLE_OWNER_ATTRIBUTE = "data-vf-studio-bridge-overlay-styles";

export type StyleInjectionWarningContext = {
  error: string;
} | Error;

type StyleDocument = Pick<Document, "createElement" | "getElementById">;

export function hasOverlayStyleElement(
  documentLike: Document,
  ownedStyle: HTMLStyleElement | null,
): boolean {
  return ownedStyle !== null && ownedStyle.ownerDocument === documentLike &&
    ownedStyle.isConnected && ownedStyle.getAttribute(OVERLAY_STYLE_OWNER_ATTRIBUTE) === "";
}

export function createOverlayStyleElement(
  documentLike: StyleDocument,
  css: string,
  nonce?: string,
): HTMLStyleElement {
  const style = documentLike.createElement("style") as HTMLStyleElement;
  style.setAttribute(OVERLAY_STYLE_OWNER_ATTRIBUTE, "");
  if (!documentLike.getElementById(OVERLAY_STYLE_ELEMENT_ID)) {
    style.id = OVERLAY_STYLE_ELEMENT_ID;
  }
  if (nonce) style.nonce = nonce;
  style.textContent = css;
  return style;
}

export function normalizeStyleInjectionWarningContext(
  error: unknown,
): StyleInjectionWarningContext {
  try {
    if (error instanceof Error) return error;
  } catch {
    return { error: "Style injection failed" };
  }
  if (
    typeof error === "string" || typeof error === "number" || typeof error === "boolean" ||
    typeof error === "bigint"
  ) {
    return { error: String(error).slice(0, 1_024) };
  }
  return { error: "Style injection failed" };
}
