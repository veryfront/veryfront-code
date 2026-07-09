/**
 * Chat Style Provider
 *
 * Injects semantic design tokens as CSS custom properties.
 * Wrap your chat UI with this component to enable token-based theming.
 *
 * @module react/components/chat-style-provider
 */

import * as React from "react";
import { getDocumentNonce } from "../ui/csp-nonce.ts";
import { getChatTokensCSS } from "./chat-tokens.ts";

export interface ChatStyleProviderProps {
  children: React.ReactNode;
}

const tokenCSS = getChatTokensCSS();

export function ChatStyleProvider({
  children,
}: ChatStyleProviderProps): React.ReactElement {
  const nonce = getDocumentNonce();

  return (
    <>
      <style nonce={nonce} dangerouslySetInnerHTML={{ __html: tokenCSS }} />
      {children}
    </>
  );
}
ChatStyleProvider.displayName = "ChatStyleProvider";
