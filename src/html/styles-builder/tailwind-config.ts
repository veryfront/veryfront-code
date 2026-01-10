import type { VeryfrontConfig } from "../../core/config/types.ts";

type TailwindConfig = VeryfrontConfig["tailwind"];

/**
 * Deep merge two objects, with source values overwriting target values
 */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key];
    const targetValue = target[key];
    if (
      sourceValue &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>,
      ) as T[keyof T];
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T];
    }
  }
  return result;
}

/**
 * Get the Tailwind CDN URL with plugins
 */
export function getTailwindCDNUrl(userConfig?: TailwindConfig): string {
  const baseUrl = "https://cdn.tailwindcss.com";
  const plugins = userConfig?.plugins;

  return plugins?.length ? `${baseUrl}?plugins=${plugins.join(",")}` : baseUrl;
}

/**
 * Default veryfront theme colors (CSS variable based)
 */
const defaultThemeExtend = {
  colors: {
    background: "hsl(var(--background))",
    foreground: "hsl(var(--foreground))",
    muted: {
      DEFAULT: "hsl(var(--muted))",
      foreground: "hsl(var(--muted-foreground))",
    },
    primary: {
      DEFAULT: "hsl(var(--primary))",
      foreground: "hsl(var(--primary-foreground))",
    },
    secondary: {
      DEFAULT: "hsl(var(--secondary))",
      foreground: "hsl(var(--secondary-foreground))",
    },
    highlight: {
      DEFAULT: "hsl(var(--highlight))",
      foreground: "hsl(var(--highlight-foreground))",
    },
    card: {
      DEFAULT: "hsl(var(--card))",
      foreground: "hsl(var(--card-foreground))",
    },
    panel: {
      DEFAULT: "hsl(var(--panel))",
      foreground: "hsl(var(--panel-foreground))",
    },
    popover: {
      DEFAULT: "hsl(var(--popover))",
      foreground: "hsl(var(--popover-foreground))",
    },
    destructive: {
      DEFAULT: "hsl(var(--destructive))",
      foreground: "hsl(var(--destructive-foreground))",
    },
    border: "hsl(var(--border))",
    divider: "hsl(var(--divider))",
    input: "hsl(var(--input))",
    ring: "hsl(var(--ring))",
    success: "hsl(var(--success))",
  },
  borderRadius: {
    DEFAULT: "var(--radius)",
    sm: "calc(var(--radius) - 4px)",
    md: "calc(var(--radius) - 2px)",
    lg: "calc(var(--radius) + 2px)",
    xl: "calc(var(--radius) + 4px)",
  },
};

/**
 * Convert project's tailwind.config.js (export default or module.exports)
 * to browser-compatible format (tailwind.config = {...})
 * This matches how veryfront-frontend handles tailwind configs
 */
export function convertTailwindConfigForBrowser(code: string): string {
  if (!code) return "";

  return code
    .replace(/export\s+default\s*{/g, "tailwind.config = {")
    .replace(/module\.exports\s*=\s*{/g, "tailwind.config = {");
}

export function generateTailwindConfig(userConfig?: TailwindConfig): string {
  // Merge user theme extensions with defaults
  const userExtend = userConfig?.theme?.extend || {};
  const mergedExtend = deepMerge(
    defaultThemeExtend as Record<string, unknown>,
    userExtend as Record<string, unknown>,
  );

  // Build the config object
  const configObject = {
    darkMode: ["class", '[data-theme="dark"]'],
    theme: {
      container: {
        center: true,
        padding: "1rem",
      },
      extend: mergedExtend,
    },
  };

  // Tailwind CDN has its own built-in MutationObserver that watches for DOM changes
  // and re-processes styles automatically. No need for manual refresh calls.
  return `tailwind.config = ${JSON.stringify(configObject, null, 6)}`;
}
