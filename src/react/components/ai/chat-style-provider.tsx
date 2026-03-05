/**
 * Chat Style Provider
 *
 * Injects semantic design tokens as CSS custom properties.
 * Wrap your chat UI with this component to enable token-based theming.
 *
 * @module ai/react/components/chat-style-provider
 */

import * as React from "react";
import { getChatTokensCSS } from "./chat-tokens.ts";

export interface ChatStyleProviderProps {
  children: React.ReactNode;
}

const tokenCSS = getChatTokensCSS();

export function ChatStyleProvider({
  children,
}: ChatStyleProviderProps): React.ReactElement {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: tokenCSS }} />
      {children}
    </>
  );
}
ChatStyleProvider.displayName = "ChatStyleProvider";
