/**
 * Chat Design Tokens
 *
 * Semantic CSS custom properties for the chat component system.
 * These tokens enable consistent theming and color mode support.
 *
 * @module ai/react/components/chat-tokens
 */

export const chatTokens = {
  light: {
    "--chat-background": "0 0% 100%",
    "--chat-foreground": "0 0% 3.9%",
    "--chat-muted": "0 0% 96.1%",
    "--chat-muted-foreground": "0 0% 45.1%",
    "--chat-border": "0 0% 89.8%",
    "--chat-input": "0 0% 100%",
    "--chat-input-border": "0 0% 82%",
    "--chat-primary": "0 0% 9%",
    "--chat-primary-foreground": "0 0% 98%",
    "--chat-accent": "0 0% 96.1%",
    "--chat-accent-foreground": "0 0% 9%",
    "--chat-destructive": "0 84.2% 60.2%",
    "--chat-destructive-foreground": "0 0% 98%",
    "--chat-ring": "0 0% 3.9%",
    "--chat-radius": "0.75rem",
    "--chat-message-user": "0 0% 96.1%",
    "--chat-message-user-foreground": "0 0% 9%",
    "--chat-message-assistant-foreground": "0 0% 20%",
    "--chat-code-background": "0 0% 96.1%",
    "--chat-code-border": "0 0% 89.8%",
  },
  dark: {
    "--chat-background": "0 0% 3.9%",
    "--chat-foreground": "0 0% 98%",
    "--chat-muted": "0 0% 14.9%",
    "--chat-muted-foreground": "0 0% 63.9%",
    "--chat-border": "0 0% 14.9%",
    "--chat-input": "0 0% 14.9%",
    "--chat-input-border": "0 0% 25%",
    "--chat-primary": "0 0% 98%",
    "--chat-primary-foreground": "0 0% 9%",
    "--chat-accent": "0 0% 14.9%",
    "--chat-accent-foreground": "0 0% 98%",
    "--chat-destructive": "0 62.8% 30.6%",
    "--chat-destructive-foreground": "0 0% 98%",
    "--chat-ring": "0 0% 83.1%",
    "--chat-radius": "0.75rem",
    "--chat-message-user": "0 0% 14.9%",
    "--chat-message-user-foreground": "0 0% 98%",
    "--chat-message-assistant-foreground": "0 0% 87%",
    "--chat-code-background": "0 0% 9%",
    "--chat-code-border": "0 0% 14.9%",
  },
} as const;

function tokensToCSS(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([key, value]) => `${key}: ${value};`)
    .join("\n    ");
}

export function getChatTokensCSS(): string {
  return `:root {
    ${tokensToCSS(chatTokens.light)}
  }

  .dark, [data-theme="dark"] {
    ${tokensToCSS(chatTokens.dark)}
  }`;
}
