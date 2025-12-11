
import { createGenerator, type UnoGenerator } from "@unocss/core";
import presetWind from "@unocss/preset-wind";
import { serverLogger as logger } from "@veryfront/utils";
import { getUnoCSSTailwindResetUrl } from "@veryfront/core/utils/constants/cdn.ts";
import type { VeryfrontConfig } from "../../core/config/types.ts";

type TailwindConfig = VeryfrontConfig["tailwind"];

let resetTailwind = "";
let resetInitialized = false;
// deno-lint-ignore no-explicit-any
let uno: UnoGenerator<any> | null = null;
let lastConfigHash = "";

function hashConfig(config?: TailwindConfig): string {
  return config ? JSON.stringify(config) : "";
}

function buildUnoTheme(tailwindConfig?: TailwindConfig): Record<string, unknown> {
  const theme: Record<string, unknown> = {};
  const extend = tailwindConfig?.theme?.extend;

  if (!extend) return theme;

  if (extend.colors) {
    theme.colors = extend.colors;
  }

  if (extend.fontFamily) {
    theme.fontFamily = extend.fontFamily;
  }

  if (extend.spacing) {
    theme.spacing = extend.spacing;
  }

  if (extend.fontSize) {
    theme.fontSize = extend.fontSize;
  }

  if (extend.screens) {
    theme.breakpoints = extend.screens;
  }

  if (extend.borderRadius) {
    theme.borderRadius = extend.borderRadius;
  }

  if (extend.animation) {
    theme.animation = extend.animation;
  }

  if (extend.keyframes) {
    theme.animation = {
      ...((theme.animation as Record<string, unknown>) || {}),
      keyframes: extend.keyframes,
    };
  }

  return theme;
}

// deno-lint-ignore no-explicit-any
async function ensureInitialized(
  tailwindConfig?: TailwindConfig,
): Promise<{ reset: string; generator: UnoGenerator<any> }> {
  const configHash = hashConfig(tailwindConfig);

  if (uno === null || configHash !== lastConfigHash) {
    lastConfigHash = configHash;
    const theme = buildUnoTheme(tailwindConfig);

    // deno-lint-ignore no-explicit-any
    uno = createGenerator({
      // deno-lint-ignore no-explicit-any
      presets: [presetWind()] as any,
      theme,
    });
  }

  if (!resetInitialized) {
    resetInitialized = true;
    try {
      resetTailwind = await fetch(getUnoCSSTailwindResetUrl()).then((r) => r.text());
    } catch (error) {
      logger.warn("Failed to fetch Tailwind reset CSS, using empty string:", error);
      resetTailwind = "";
    }
  }

  return { reset: resetTailwind, generator: uno };
}

export async function generateTailwindCSS(
  htmlContent: string,
  tailwindConfig?: TailwindConfig,
): Promise<string> {
  try {
    const { reset, generator } = await ensureInitialized(tailwindConfig);

    const result = await generator.generate(htmlContent, {
      minify: false,
    });

    return `${reset}\n${result.css}`;
  } catch (error) {
    logger.error("UnoCSS generation error:", error);
    return "";
  }
}

export function extractClassNames(htmlContent: string): Set<string> {
  const classPattern = /class="([^"]*)"/g;
  const classNames = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = classPattern.exec(htmlContent)) !== null) {
    const classes = (match[1] || "").split(/\s+/);
    classes.forEach((cls) => {
      if (cls.trim()) classNames.add(cls.trim());
    });
  }

  return classNames;
}
