import type { VeryfrontConfig } from "../../core/config/types.ts";

type TailwindConfig = VeryfrontConfig["tailwind"];

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

export function getTailwindCDNUrl(userConfig?: TailwindConfig): string {
  const baseUrl = "https://cdn.tailwindcss.com";
  const plugins = userConfig?.plugins;

  if (plugins && plugins.length > 0) {
    return `${baseUrl}?plugins=${plugins.join(",")}`;
  }

  return baseUrl;
}

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

export function generateTailwindConfig(userConfig?: TailwindConfig): string {
  const userExtend = userConfig?.theme?.extend || {};
  const mergedExtend = deepMerge(
    defaultThemeExtend as Record<string, unknown>,
    userExtend as Record<string, unknown>,
  );

  const configObject = {
    darkMode: ["class", '[data-theme="dark"]'],
    theme: {
      extend: mergedExtend,
    },
  };

  return `
    tailwind.config = ${JSON.stringify(configObject, null, 6)}

    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => {
        if (window.tailwind && window.tailwind.refresh) {
          window.tailwind.refresh();
        }
      });

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
          });
        });
      } else {
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class']
        });
      }
    }
  `;
}
