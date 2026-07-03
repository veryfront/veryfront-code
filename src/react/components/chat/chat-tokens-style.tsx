/**
 * ChatTokens — injects the chat design tokens as a global `:root` stylesheet.
 *
 * The tokens (`--primary`, `--accent`, …) are what every chat surface's utility
 * classes (`bg-[var(--primary)]`, …) resolve against. `<Chat>` injects them for
 * its own subtree, but surfaces rendered *outside* `<Chat>` — `<ChatSidebar>`,
 * `<AttachmentsPanel>`, an app shell, a page with no chat at all — need them
 * too. So every top-level chat surface renders this; the CSS is identical and
 * global, so duplicate tags are harmless.
 *
 * @module react/components/chat/chat-tokens-style
 */
import * as React from "react";
import { getDocumentNonce } from "./csp-nonce.ts";
import { generateTokenCSS } from "./theme.ts";

const tokenCSS = generateTokenCSS();

/** Global chat design-token stylesheet. Idempotent — render it anywhere. */
export function ChatTokens(): React.ReactElement {
  const nonce = getDocumentNonce();
  return <style nonce={nonce} dangerouslySetInnerHTML={{ __html: tokenCSS }} />;
}
ChatTokens.displayName = "ChatTokens";
