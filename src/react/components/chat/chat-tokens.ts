/**
 * Chat Design Tokens
 *
 * Semantic CSS custom properties for the chat component system.
 * These tokens enable consistent theming and color mode support.
 *
 * @module react/components/chat-tokens
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

const providerTokens = {
  light: {
    "--background": "#F0EFE9",
    "--foreground": "#010101",
    "--primary": "#282828",
    "--secondary": "#FFFFFF",
    "--tertiary": "#F0EFE9",
    "--accent": "#E8E6DB",
    "--muted": "#F7F6F4",
    "--destructive": "#D40C1A",
    "--outline-border": "#DCDAD0",
    "--faint": "oklch(from var(--foreground) l c h / 0.25)",
    "--edge": "oklch(from var(--foreground) l c h / 0.06)",
    "--edge-medium": "oklch(from var(--foreground) l c h / 0.1)",
    "--input-bg": "var(--secondary)",
    "--popover": "var(--secondary)",
    "--chat-background": "var(--background)",
    "--chat-foreground": "var(--foreground)",
    "--chat-muted": "var(--muted)",
    "--chat-muted-foreground": "var(--faint)",
    "--chat-border": "var(--outline-border)",
    "--chat-input": "var(--input-bg)",
    "--chat-input-border": "var(--edge-medium)",
    "--chat-primary": "var(--primary)",
    "--chat-primary-foreground": "var(--secondary)",
    "--chat-accent": "var(--accent)",
    "--chat-accent-foreground": "var(--foreground)",
    "--chat-destructive": "var(--destructive)",
    "--chat-destructive-foreground": "#FFFFFF",
    "--chat-ring": "var(--edge-medium)",
    "--chat-radius": "20px",
    "--chat-message-user": "var(--primary)",
    "--chat-message-user-foreground": "var(--secondary)",
    "--chat-message-assistant-foreground": "var(--foreground)",
    "--chat-code-background": "var(--secondary)",
    "--chat-code-border": "var(--outline-border)",
  },
  dark: {
    "--background": "#282828",
    "--foreground": "#F0EFE9",
    "--primary": "#F1F0EA",
    "--secondary": "#333333",
    "--tertiary": "#262626",
    "--accent": "#303030",
    "--muted": "#0D1315",
    "--destructive": "#D40C1A",
    "--outline-border": "#3A3A3A",
    "--faint": "oklch(from var(--foreground) l c h / 0.25)",
    "--edge": "oklch(from var(--foreground) l c h / 0.06)",
    "--edge-medium": "oklch(from var(--foreground) l c h / 0.1)",
    "--input-bg": "#40403F",
    "--popover": "var(--secondary)",
    "--chat-background": "var(--background)",
    "--chat-foreground": "var(--foreground)",
    "--chat-muted": "var(--muted)",
    "--chat-muted-foreground": "var(--faint)",
    "--chat-border": "var(--outline-border)",
    "--chat-input": "var(--input-bg)",
    "--chat-input-border": "var(--edge-medium)",
    "--chat-primary": "var(--primary)",
    "--chat-primary-foreground": "var(--secondary)",
    "--chat-accent": "var(--accent)",
    "--chat-accent-foreground": "var(--foreground)",
    "--chat-destructive": "var(--destructive)",
    "--chat-destructive-foreground": "#FFFFFF",
    "--chat-ring": "var(--edge-medium)",
    "--chat-radius": "20px",
    "--chat-message-user": "var(--primary)",
    "--chat-message-user-foreground": "var(--secondary)",
    "--chat-message-assistant-foreground": "var(--foreground)",
    "--chat-code-background": "var(--secondary)",
    "--chat-code-border": "var(--outline-border)",
  },
} as const;

function tokensToCSS(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([key, value]) => `${key}: ${value};`)
    .join("\n    ");
}

export function getChatTokensCSS(): string {
  return `:root {
    ${tokensToCSS(providerTokens.light)}
  }

  .dark, [data-theme="dark"] {
    ${tokensToCSS(providerTokens.dark)}
  }`;
}
