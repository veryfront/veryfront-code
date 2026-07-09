/**
 * DesignTokenStyle — injects the `[data-vf-chat]`-scoped design-token
 * stylesheet.
 *
 * The tokens (`--primary`, `--accent`, …) are what every primitive's utility
 * classes (`bg-[var(--primary)]`, …) resolve against. They are deliberately
 * NOT on `:root`: the names collide with host apps' own theme variables (see
 * `generateTokenCSS`). A surface renders this AND sets `data-vf-chat` on its
 * root element; the CSS is identical everywhere, so duplicate tags are harmless.
 *
 * `veryfront/chat` re-exports this as `ChatTokens` for back-compat.
 *
 * @module react/components/ui/tokens
 */
import * as React from "react";
import { getDocumentNonce } from "./csp-nonce.ts";
import { generateTokenCSS } from "./design-tokens.ts";

const tokenCSS = generateTokenCSS();

/** Scoped design-token stylesheet. Idempotent — render it anywhere. */
export function DesignTokenStyle(): React.ReactElement {
  const nonce = getDocumentNonce();
  return <style nonce={nonce} dangerouslySetInnerHTML={{ __html: tokenCSS }} />;
}
DesignTokenStyle.displayName = "DesignTokenStyle";
