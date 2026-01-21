/**
 * Tailwind CSS v4 JIT Compiler
 *
 * Uses Tailwind 4's programmatic compile() API for consistent CSS generation
 * in both development and production modes.
 */

import { compile } from "tailwindcss";
import { serverLogger as logger } from "#veryfront/utils";
import { getTailwindCSSUrl } from "#veryfront/utils/constants/cdn.ts";
import type { VeryfrontConfig } from "#veryfront/config/types.ts";

type TailwindConfig = VeryfrontConfig["tailwind"];

// Cached compiler and CSS
let compilerPromise: Promise<Awaited<ReturnType<typeof compile>>> | null = null;
let tailwindCSS: string | null = null;
let lastConfigHash = "";

function hashConfig(config?: TailwindConfig): string {
  return config ? JSON.stringify(config) : "";
}

/**
 * Fetch Tailwind base CSS from CDN (cached)
 */
async function fetchTailwindCSS(): Promise<string> {
  if (tailwindCSS) return tailwindCSS;

  const response = await fetch(getTailwindCSSUrl());
  if (!response.ok) {
    throw new Error(`Failed to fetch Tailwind CSS: ${response.status}`);
  }
  tailwindCSS = await response.text();
  return tailwindCSS;
}

/**
 * Build custom theme CSS for veryfront color system
 */
function buildCustomTheme(tailwindConfig?: TailwindConfig): string {
  const themeVars = `
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
`;

  return `
@theme {
${themeVars}
}
${tailwindConfig?.customCSS || ""}`;
}

/**
 * Get or create the Tailwind compiler
 */
async function getCompiler(
  tailwindConfig?: TailwindConfig,
): Promise<Awaited<ReturnType<typeof compile>>> {
  const configHash = hashConfig(tailwindConfig);

  if (compilerPromise === null || configHash !== lastConfigHash) {
    lastConfigHash = configHash;

    const baseCss = await fetchTailwindCSS();
    const customTheme = buildCustomTheme(tailwindConfig);

    compilerPromise = compile(baseCss + customTheme, {
      base: "/",
      async loadStylesheet(_id: string, _base: string) {
        return { content: "", base: "/", path: "/" };
      },
      async loadModule(_id: string, _base: string) {
        return { module: {}, base: "/", path: "/" };
      },
    });
  }

  return compilerPromise;
}

/**
 * Extract class names from HTML
 */
function extractClassNames(html: string): string[] {
  const classes = new Set<string>();
  const pattern = /class(?:Name)?="([^"]*)"/g;

  let match;
  while ((match = pattern.exec(html)) !== null) {
    for (const cls of (match[1] || "").split(/\s+/)) {
      if (cls) classes.add(cls);
    }
  }

  return Array.from(classes);
}

/**
 * Normalize arbitrary values: convert commas to underscores
 * e.g., grid-cols-[0.25fr,0.5fr] -> grid-cols-[0.25fr_0.5fr]
 */
function normalizeClass(cls: string): string {
  if (!cls.includes("[") || !cls.includes(",")) return cls;
  return cls.replace(/\[([^\]]*)\]/g, (_, c) => `[${c.replace(/,/g, "_")}]`);
}

/**
 * Generate CSS aliases for comma-syntax classes
 */
function generateAliases(classes: string[], css: string): string {
  const aliases: string[] = [];

  for (const cls of classes) {
    if (!cls.includes("[") || !cls.includes(",")) continue;

    const normalized = normalizeClass(cls);
    const escaped = normalized.replace(/([[\].:#(),>+~=|^$*])/g, "\\$1");
    const pattern = new RegExp(
      `\\.${escaped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    );
    const match = css.match(pattern);

    if (match?.[1]) {
      const origEscaped = cls.replace(/([[\].:#(),>+~=|^$*])/g, "\\$1");
      aliases.push(`.${origEscaped} {${match[1]}}`);
    }
  }

  return aliases.length ? `\n/* Comma-syntax aliases */\n${aliases.join("\n")}` : "";
}

/**
 * Generate Tailwind CSS from HTML content
 */
export async function generateTailwindCSS(
  html: string,
  tailwindConfig?: TailwindConfig,
): Promise<string> {
  try {
    const compiler = await getCompiler(tailwindConfig);
    const classes = extractClassNames(html);
    const normalized = classes.map(normalizeClass);

    const css = compiler.build(normalized);
    const aliases = generateAliases(classes, css);

    return css + aliases;
  } catch (error) {
    logger.error("Tailwind 4 compilation error:", error);
    return "";
  }
}

export { extractClassNames };
