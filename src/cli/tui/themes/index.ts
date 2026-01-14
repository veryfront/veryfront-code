/**
 * Theme System
 *
 * Exports all themes and provides theme management utilities.
 */

export type {
  AnsiColor,
  BorderChars,
  Color,
  ColorPalette,
  SymbolSet,
  SyntaxColors,
  Theme,
  ThemeConfig,
} from "./types.ts";

export { ASCII_SYMBOLS, BORDER_CHARS, DEFAULT_SYMBOLS } from "./types.ts";

export { defaultTheme } from "./default.ts";
export { snazzyTheme } from "./snazzy.ts";
export { colorblindTheme } from "./colorblind.ts";

import { defaultTheme } from "./default.ts";
import { snazzyTheme } from "./snazzy.ts";
import { colorblindTheme } from "./colorblind.ts";
import type { SymbolSet, SyntaxColors, Theme, ThemeConfig } from "./types.ts";
import { BORDER_CHARS, DEFAULT_SYMBOLS } from "./types.ts";

// ============================================================================
// Theme Registry
// ============================================================================

const themes = new Map<string, Theme>([
  ["default", defaultTheme],
  ["snazzy", snazzyTheme],
  ["colorblind", colorblindTheme],
]);

/**
 * Get a theme by name
 */
export function getTheme(name: string): Theme | undefined {
  return themes.get(name);
}

/**
 * Get all available theme names
 */
export function getThemeNames(): string[] {
  return Array.from(themes.keys());
}

/**
 * Register a custom theme
 */
export function registerTheme(theme: Theme): void {
  themes.set(theme.name, theme);
}

// ============================================================================
// Theme Creation
// ============================================================================

/**
 * Create a theme from a partial configuration
 */
export function createTheme(config: ThemeConfig): Theme {
  const borderStyle = config.borderStyle ?? "rounded";

  const defaultSyntax: SyntaxColors = {
    keyword: "magenta",
    string: "green",
    number: "yellow",
    comment: "gray",
    function: "blue",
    variable: "cyan",
    type: "yellow",
    operator: "white",
    added: "green",
    removed: "red",
    modified: "yellow",
  };

  return {
    name: config.name,
    description: config.description,
    colors: config.colors,
    syntax: { ...defaultSyntax, ...config.syntax },
    symbols: { ...DEFAULT_SYMBOLS, ...config.symbols } as SymbolSet,
    borderStyle,
    borders: BORDER_CHARS[borderStyle],
    isLight: config.isLight ?? false,
    colorblindFriendly: config.colorblindFriendly ?? false,
  };
}

/**
 * Create a light variant of an existing theme
 */
export function createLightVariant(theme: Theme, name?: string): Theme {
  return {
    ...theme,
    name: name ?? `${theme.name}-light`,
    isLight: true,
    colors: {
      ...theme.colors,
      text: {
        primary: "black",
        secondary: "gray",
        muted: "gray",
      },
      background: {
        primary: "white",
        secondary: "white",
        highlight: theme.colors.primary,
      },
      selection: {
        fg: "white",
        bg: theme.colors.primary,
      },
    },
  };
}

// ============================================================================
// Theme Detection
// ============================================================================

/**
 * Detect the best theme based on environment
 */
export function detectTheme(): Theme {
  // Check for colorblind mode preference
  const accessibilityMode = getEnv("VERYFRONT_ACCESSIBILITY");
  if (accessibilityMode === "colorblind") {
    return colorblindTheme;
  }

  // Check for explicit theme preference
  const themeName = getEnv("VERYFRONT_THEME");
  if (themeName) {
    const theme = getTheme(themeName);
    if (theme) return theme;
  }

  // Check for light/dark mode preference
  // macOS: defaults read -g AppleInterfaceStyle
  // Linux: gsettings get org.gnome.desktop.interface color-scheme
  // For now, default to dark
  const colorScheme = getEnv("COLOR_SCHEME") || getEnv("COLORFGBG");
  if (colorScheme?.includes("light")) {
    return createLightVariant(defaultTheme);
  }

  return defaultTheme;
}

function getEnv(name: string): string | undefined {
  if (typeof Deno !== "undefined") {
    // @ts-ignore - Deno global
    return Deno.env?.get?.(name);
  }
  return process?.env?.[name];
}
