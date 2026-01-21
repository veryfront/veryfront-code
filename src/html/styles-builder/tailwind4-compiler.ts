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
      loadStylesheet(_id: string, _base: string) {
        return Promise.resolve({ content: "", base: "/", path: "/" });
      },
      loadModule(_id: string, _base: string) {
        return Promise.resolve({ module: {}, base: "/", path: "/" });
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
 * Extract class names from source code (TSX/JSX/MDX).
 * Handles static strings, template literals, and function calls like cn/clsx.
 */
function extractClassNamesFromSource(source: string): string[] {
  const classes = new Set<string>();

  // Pattern 1: className="..." or class="..."
  const staticPattern = /class(?:Name)?="([^"]*)"/g;
  let match;
  while ((match = staticPattern.exec(source)) !== null) {
    for (const cls of (match[1] || "").split(/\s+/)) {
      if (cls) classes.add(cls);
    }
  }

  // Pattern 2: className='...'
  const singleQuotePattern = /class(?:Name)?='([^']*)'/g;
  while ((match = singleQuotePattern.exec(source)) !== null) {
    for (const cls of (match[1] || "").split(/\s+/)) {
      if (cls) classes.add(cls);
    }
  }

  // Pattern 3: className={`...`} template literals (extract string parts)
  const templatePattern = /class(?:Name)?=\{`([^`]*)`\}/g;
  while ((match = templatePattern.exec(source)) !== null) {
    // Remove ${...} interpolations and extract remaining classes
    const cleaned = (match[1] || "").replace(/\$\{[^}]*\}/g, " ");
    for (const cls of cleaned.split(/\s+/)) {
      if (cls) classes.add(cls);
    }
  }

  // Pattern 4: cn(...), clsx(...), classNames(...) - extract string literals
  const cnPattern = /(?:cn|clsx|classNames)\s*\(\s*([^)]+)\)/g;
  while ((match = cnPattern.exec(source)) !== null) {
    const args = match[1] || "";
    // Extract double-quoted strings
    const dqStrings = args.match(/"([^"]*)"/g) || [];
    for (const str of dqStrings) {
      for (const cls of str.slice(1, -1).split(/\s+/)) {
        if (cls) classes.add(cls);
      }
    }
    // Extract single-quoted strings
    const sqStrings = args.match(/'([^']*)'/g) || [];
    for (const str of sqStrings) {
      for (const cls of str.slice(1, -1).split(/\s+/)) {
        if (cls) classes.add(cls);
      }
    }
    // Extract template literals
    const tlStrings = args.match(/`([^`]*)`/g) || [];
    for (const str of tlStrings) {
      const cleaned = str.slice(1, -1).replace(/\$\{[^}]*\}/g, " ");
      for (const cls of cleaned.split(/\s+/)) {
        if (cls) classes.add(cls);
      }
    }
  }

  return Array.from(classes);
}

/**
 * Normalize arbitrary values:
 * 1. Convert commas to underscores: grid-cols-[0.25fr,0.5fr] -> grid-cols-[0.25fr_0.5fr]
 * 2. Wrap CSS variables with var(): aspect-[--ratio] -> aspect-[var(--ratio)]
 * 3. Convert aspect ratio slashes to underscores: aspect-[800/450] -> aspect-[800/450] (kept as-is, handled by alias)
 */
function normalizeClass(cls: string): string {
  if (!cls.includes("[")) return cls;

  return cls.replace(/\[([^\]]*)\]/g, (_match, content) => {
    let normalized = content;

    // Wrap bare CSS variables with var()
    // Matches --name or --name/opacity but not already wrapped var(--name)
    if (/^--[\w-]+(?:\/[\d.]+)?$/.test(normalized) && !normalized.includes("var(")) {
      normalized = `var(${normalized})`;
    }

    // Convert commas to underscores
    if (normalized.includes(",")) {
      normalized = normalized.replace(/,/g, "_");
    }

    return `[${normalized}]`;
  });
}

/**
 * Check if a class is an aspect ratio with slash syntax (Tailwind 3 style)
 * Examples: aspect-[800/450], aspect-[16/9], aspect-[4/3]
 */
function isAspectRatioWithSlash(cls: string): boolean {
  return /^aspect-\[\d+\/\d+\]$/.test(cls);
}

/**
 * Generate CSS for aspect ratio classes with slash syntax.
 * Tailwind 4 doesn't natively support aspect-[800/450], so we generate the CSS directly.
 */
function generateAspectRatioCSS(cls: string): string | null {
  const match = cls.match(/^aspect-\[(\d+)\/(\d+)\]$/);
  if (!match) return null;

  const width = match[1];
  const height = match[2];

  // Escape the class selector: aspect-[800/450] -> aspect-\[800\/450\]
  const selector = cls.replace(/([[\]/])/g, "\\$1");

  return `.${selector} { aspect-ratio: ${width} / ${height} !important; }`;
}

/**
 * Check if a class needs normalization (has comma or bare CSS variable)
 */
function needsNormalization(cls: string): boolean {
  if (!cls.includes("[")) return false;
  // Check for comma syntax: grid-cols-[0.25fr,0.5fr]
  if (cls.includes(",")) return true;
  // Check for bare CSS variable: aspect-[--ratio]
  const match = cls.match(/\[([^\]]*)\]/);
  const content = match?.[1];
  if (content) {
    // Bare CSS variable: --name or --name/opacity, not already wrapped in var()
    if (/^--[\w-]+(?:\/[\d.]+)?$/.test(content) && !content.includes("var(")) {
      return true;
    }
  }
  return false;
}

/**
 * Escape string for use in a regex to match it literally
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Generate CSS aliases for classes that need normalization
 * (comma-syntax and bare CSS variable classes)
 *
 * For each class that needs normalization, we:
 * 1. Build the CSS selector for the NORMALIZED class as Tailwind generates it
 * 2. Search for that selector in the generated CSS
 * 3. Extract the CSS properties
 * 4. Create an alias with the ORIGINAL class name pointing to those properties
 */
function generateAliases(classes: string[], css: string): string {
  const aliases: string[] = [];

  for (const cls of classes) {
    if (!needsNormalization(cls)) continue;

    const normalized = normalizeClass(cls);

    // Build the CSS selector as Tailwind generates it
    // Tailwind escapes: [ ] ( ) : and . (decimal points)
    // Example: grid-cols-[0.68fr_0.32fr] -> grid-cols-\[0\.68fr_0\.32fr\]
    const cssSelector = normalized.replace(/([[\]().:])/g, "\\$1");

    // Escape the entire CSS selector for use in a regex
    const regexSelector = escapeRegex(cssSelector);

    const isResponsive = cls.includes(":");

    let cssProperties: string | null = null;

    if (isResponsive) {
      // For responsive classes like md:grid-cols-[...], the CSS structure is:
      // .md\:grid-cols-\[...\] { @media (...) { property: value; } }
      const pattern = new RegExp(
        `\\.${regexSelector}\\s*\\{\\s*@media[^{]*\\{([^}]*)\\}`,
      );
      const match = css.match(pattern);
      cssProperties = match?.[1]?.trim() || null;
    } else {
      // For non-responsive classes, the structure is:
      // .class-\[...\] { property: value; }
      const pattern = new RegExp(`\\.${regexSelector}\\s*\\{([^}]*)\\}`);
      const match = css.match(pattern);
      cssProperties = match?.[1]?.trim() || null;
    }

    if (cssProperties) {
      // Build the original class selector (CSS-escaped)
      // Must escape: [ ] ( ) . : and , (commas are CSS selector separators)
      const origSelector = cls.replace(/([[\]().:,])/g, "\\$1");
      // Add !important to override CDN-generated CSS in development
      const importantProps = cssProperties.replace(/;/g, " !important;");
      if (isResponsive) {
        // Extract the media query from the normalized class rule
        const mediaPattern = new RegExp(
          `\\.${regexSelector}\\s*\\{\\s*(@media[^{]*)\\{`,
        );
        const mediaMatch = css.match(mediaPattern);
        const mediaQuery = mediaMatch?.[1]?.trim() || "@media (width >= 48rem)";
        aliases.push(`.${origSelector} { ${mediaQuery} { ${importantProps} } }`);
      } else {
        aliases.push(`.${origSelector} { ${importantProps} }`);
      }
    }
  }

  return aliases.length ? `\n/* Normalized class aliases */\n${aliases.join("\n")}` : "";
}

/**
 * Classes that commonly need normalization or may be rendered client-side.
 * These are always included to ensure correct CSS is generated.
 *
 * Common patterns that need safelisting:
 * - aspect-[--ratio]: CSS variable aspect ratios
 * - aspect-[800/450]: Common image dimensions (16:9-ish)
 * - aspect-[16/9], aspect-[4/3]: Standard video/photo ratios
 * - Skeleton components often use these during client-side loading states
 */
const SAFELIST_CLASSES = [
  "aspect-[--ratio]",
  "aspect-[800/450]",
  "aspect-[16/9]",
  "aspect-[4/3]",
  "aspect-[3/2]",
  "aspect-[2/3]",
  "aspect-[1/1]",
];

/**
 * Generate CSS for aspect ratio classes that Tailwind 4 doesn't handle natively
 */
function generateAspectRatioAliases(classes: string[]): string {
  const aspectCSS: string[] = [];
  for (const cls of classes) {
    if (isAspectRatioWithSlash(cls)) {
      const css = generateAspectRatioCSS(cls);
      if (css) aspectCSS.push(css);
    }
  }
  return aspectCSS.length ? `\n/* Aspect ratio aliases */\n${aspectCSS.join("\n")}` : "";
}

/**
 * Options for CSS generation
 */
export interface GenerateCSSOptions {
  /** Tailwind configuration */
  tailwindConfig?: TailwindConfig;
  /** Pre-extracted project classes from source files (for complete coverage) */
  projectClasses?: Set<string> | string[];
}

/**
 * Generate Tailwind CSS from HTML content
 *
 * @param html - Rendered HTML to extract classes from
 * @param options - Generation options including project-wide classes
 */
export async function generateTailwindCSS(
  html: string,
  options?: GenerateCSSOptions | TailwindConfig,
): Promise<string> {
  try {
    // Handle legacy signature (tailwindConfig as second param)
    const opts: GenerateCSSOptions = options && typeof options === "object" && "tailwind" in options
      ? { tailwindConfig: options as TailwindConfig }
      : (options as GenerateCSSOptions) ?? {};

    const compiler = await getCompiler(opts.tailwindConfig);
    const extractedClasses = extractClassNames(html);

    // Merge: extracted from HTML + safelist + project-wide classes
    const classSet = new Set(extractedClasses);
    for (const cls of SAFELIST_CLASSES) {
      classSet.add(cls);
    }
    // Add project-wide classes (from source file scanning)
    if (opts.projectClasses) {
      for (const cls of opts.projectClasses) {
        classSet.add(cls);
      }
    }
    const classes = Array.from(classSet);

    const normalized = classes.map(normalizeClass);

    const css = compiler.build(normalized);
    const aliases = generateAliases(classes, css);
    const aspectAliases = generateAspectRatioAliases(classes);

    return css + aliases + aspectAliases;
  } catch (error) {
    logger.error("Tailwind 4 compilation error:", error);
    return "";
  }
}

/**
 * Generate Tailwind CSS from source file contents.
 * Extracts class names from TSX/JSX/MDX source code and compiles CSS.
 * Used for SPA navigation where we don't have rendered HTML.
 */
export async function generateCSSFromSources(
  sources: string[],
  tailwindConfig?: TailwindConfig,
): Promise<string> {
  try {
    const compiler = await getCompiler(tailwindConfig);
    const allClasses = new Set<string>();

    for (const source of sources) {
      for (const cls of extractClassNamesFromSource(source)) {
        allClasses.add(cls);
      }
    }

    const classes = Array.from(allClasses);
    const normalized = classes.map(normalizeClass);

    const css = compiler.build(normalized);
    const aliases = generateAliases(classes, css);
    const aspectAliases = generateAspectRatioAliases(classes);

    return css + aliases + aspectAliases;
  } catch (error) {
    logger.error("Tailwind 4 source compilation error:", error);
    return "";
  }
}

export { extractClassNames, extractClassNamesFromSource };
