/**
 * ChatThemeScope — establishes the `[data-vf-chat]` token scope that the chat
 * UI's `[var(--token)]` classes resolve against. `<Chat>` injects this scope
 * for itself, but when you compose the chat primitives *around* it — a sidebar,
 * header tabs, an uploads panel in your own shell — those live outside `<Chat>`
 * and would render unstyled. Wrap your shell in one `ChatThemeScope` so every
 * chat primitive inside it is themed:
 *
 * ```tsx
 * <ChatThemeScope className="h-screen">
 *   <AppShell> …sidebar… <Chat … /> </AppShell>
 * </ChatThemeScope>
 * ```
 *
 * @module react/components/chat/chat-theme-scope
 */
import * as React from "react";
import { getDocumentNonce } from "../ui/csp-nonce.ts";
import { cn, generateTokenCSS } from "./theme.ts";

/** Props accepted by {@link ChatThemeScope}. */
export interface ChatThemeScopeProps {
  children: React.ReactNode;
  /** Extra classes for the scope element. */
  className?: string;
}

/** Wrap chat primitives in the `[data-vf-chat]` token scope so they're themed. */
export function ChatThemeScope(
  { children, className }: ChatThemeScopeProps,
): React.ReactElement {
  const nonce = getDocumentNonce();
  const tokenCSS = React.useMemo(() => generateTokenCSS(), []);
  return (
    <div
      data-vf-chat=""
      className={cn("bg-[var(--background)] text-[var(--foreground)]", className)}
    >
      <style nonce={nonce} dangerouslySetInnerHTML={{ __html: tokenCSS }} />
      {children}
    </div>
  );
}
