import type { VeryfrontConfig } from "#veryfront/config/types.ts";

type TailwindConfig = VeryfrontConfig["tailwind"];

/**
 * Get the Tailwind v4 CDN URL
 * Uses the new @tailwindcss/browser package
 */
export function getTailwindCDNUrl(_userConfig?: TailwindConfig): string {
  return "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4";
}

/**
 * Default veryfront theme using Tailwind v4 @theme directive
 * Defines CSS variables for colors, fonts, and other design tokens
 */
export function generateTailwindV4Theme(userConfig?: TailwindConfig): string {
  // Base theme variables
  const themeVars = `
  /* Colors - CSS variable based for light/dark mode support */
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));
  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));
  --color-highlight: hsl(var(--highlight));
  --color-highlight-foreground: hsl(var(--highlight-foreground));
  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --color-panel: hsl(var(--panel));
  --color-panel-foreground: hsl(var(--panel-foreground));
  --color-popover: hsl(var(--popover));
  --color-popover-foreground: hsl(var(--popover-foreground));
  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));
  --color-border: hsl(var(--border));
  --color-divider: hsl(var(--divider));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));
  --color-success: hsl(var(--success));

  /* Font families */
  --font-sans: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
  --font-serif: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  --font-display: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";

  /* Border radius */
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-DEFAULT: var(--radius);
  --radius-lg: calc(var(--radius) + 2px);
  --radius-xl: calc(var(--radius) + 4px);
`;

  // Include custom CSS from config if provided
  const customCSS = userConfig?.customCSS || "";

  return `@theme {
${themeVars}
}
${customCSS}`;
}

/**
 * Convert project's tailwind.config.js to Tailwind v4 @theme format
 * This is a compatibility layer - projects should migrate to @theme CSS
 *
 * @deprecated Projects should use @theme CSS directly instead
 */
export function convertTailwindConfigForBrowser(code: string): string {
  if (!code) return "";

  // For v4, we don't use JavaScript config anymore
  // Return empty - project should define @theme in CSS
  console.warn(
    "[Tailwind v4] JavaScript config is deprecated. Use @theme CSS directive instead.",
  );
  return "";
}

/**
 * @deprecated Use generateTailwindV4Theme instead
 */
export function generateTailwindConfig(userConfig?: TailwindConfig): string {
  // For backwards compatibility, return empty
  // v4 uses @theme CSS, not JavaScript config
  return "";
}
