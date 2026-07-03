/**
 * ChatTokens — injects the `[data-vf-chat]`-scoped chat design-token
 * stylesheet.
 *
 * The tokens (`--primary`, `--accent`, …) are what every chat surface's utility
 * classes (`bg-[var(--primary)]`, …) resolve against. They are deliberately
 * NOT on `:root`: the names collide with host apps' own theme variables (see
 * `generateTokenCSS`). `<Chat>` injects them for its own subtree; a surface
 * rendered *outside* `<Chat>` — `<ChatSidebar>`, `<AttachmentsPanel>`,
 * `<AppShell>` — renders this AND sets `data-vf-chat` on its root element.
 * The CSS is identical everywhere, so duplicate tags are harmless.
 *
 * @module react/components/chat/chat-tokens-style
 */
import * as React from "react";
import { getDocumentNonce } from "./csp-nonce.ts";
import { generateTokenCSS } from "./theme.ts";

const tokenCSS = generateTokenCSS();

/** Scoped chat design-token stylesheet. Idempotent — render it anywhere. */
export function ChatTokens(): React.ReactElement {
  const nonce = getDocumentNonce();
  return <style nonce={nonce} dangerouslySetInnerHTML={{ __html: tokenCSS }} />;
}
ChatTokens.displayName = "ChatTokens";
