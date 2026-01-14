/**
 * Theme Type Definitions
 *
 * Defines the structure for TUI themes including colors,
 * symbols, and visual styling options.
 */

// ============================================================================
// Color Types
// ============================================================================

/** Named ANSI colors */
export type AnsiColor =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "gray"
  | "grey";

/** Extended color (ANSI name, 256-color code, or hex) */
export type Color = AnsiColor | number | `#${string}`;

// ============================================================================
// Theme Structure
// ============================================================================

export interface ColorPalette {
  /** Primary accent color */
  primary: Color;
  /** Secondary accent color */
  secondary: Color;
  /** Tertiary/highlight color */
  accent: Color;

  /** Success state color */
  success: Color;
  /** Warning state color */
  warning: Color;
  /** Error state color */
  error: Color;
  /** Info state color */
  info: Color;

  /** Text colors */
  text: {
    /** Primary text */
    primary: Color;
    /** Secondary/muted text */
    secondary: Color;
    /** Disabled/very muted text */
    muted: Color;
  };

  /** Background colors */
  background: {
    /** Primary background */
    primary: Color;
    /** Secondary/elevated background */
    secondary: Color;
    /** Highlighted/selected background */
    highlight: Color;
  };

  /** Border colors */
  border: {
    /** Active/focused border */
    active: Color;
    /** Inactive border */
    inactive: Color;
  };

  /** Selection colors */
  selection: {
    /** Selected item foreground */
    fg: Color;
    /** Selected item background */
    bg: Color;
  };
}

export interface SyntaxColors {
  /** Keywords (if, else, return, etc.) */
  keyword: Color;
  /** String literals */
  string: Color;
  /** Numeric literals */
  number: Color;
  /** Comments */
  comment: Color;
  /** Function names */
  function: Color;
  /** Variable names */
  variable: Color;
  /** Type names */
  type: Color;
  /** Operators */
  operator: Color;
  /** Added lines (diff) */
  added: Color;
  /** Removed lines (diff) */
  removed: Color;
  /** Modified lines (diff) */
  modified: Color;
}

export interface SymbolSet {
  /** Success indicator */
  success: string;
  /** Error indicator */
  error: string;
  /** Warning indicator */
  warning: string;
  /** Info indicator */
  info: string;
  /** Question indicator */
  question: string;
  /** Bullet point */
  bullet: string;
  /** Pointer/arrow for selection */
  pointer: string;
  /** Right arrow */
  arrowRight: string;
  /** Left arrow */
  arrowLeft: string;
  /** Up arrow */
  arrowUp: string;
  /** Down arrow */
  arrowDown: string;
  /** Checkbox on/selected */
  checkboxOn: string;
  /** Checkbox off/unselected */
  checkboxOff: string;
  /** Radio button on */
  radioOn: string;
  /** Radio button off */
  radioOff: string;
  /** Progress bar filled segment */
  progressFilled: string;
  /** Progress bar empty segment */
  progressEmpty: string;
  /** Spinner frames */
  spinner: string[];
  /** Ellipsis for truncation */
  ellipsis: string;
  /** Lightning/bolt for quick actions */
  lightning: string;
  /** Git branch indicator */
  gitBranch: string;
  /** Folder indicator */
  folder: string;
  /** File indicator */
  file: string;
}

export interface BorderChars {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  horizontal: string;
  vertical: string;
  teeLeft: string;
  teeRight: string;
  teeTop: string;
  teeBottom: string;
  cross: string;
}

export interface Theme {
  /** Theme name */
  name: string;

  /** Theme description */
  description?: string;

  /** Color palette */
  colors: ColorPalette;

  /** Syntax highlighting colors */
  syntax: SyntaxColors;

  /** Symbol set */
  symbols: SymbolSet;

  /** Border style */
  borderStyle: "single" | "double" | "rounded";

  /** Border characters (derived from borderStyle) */
  borders: BorderChars;

  /** Whether this is a light theme (affects some defaults) */
  isLight: boolean;

  /** Whether this theme is colorblind-friendly */
  colorblindFriendly: boolean;
}

// ============================================================================
// Theme Creation Helper
// ============================================================================

export interface ThemeConfig {
  name: string;
  description?: string;
  colors: ColorPalette;
  syntax?: Partial<SyntaxColors>;
  symbols?: Partial<SymbolSet>;
  borderStyle?: "single" | "double" | "rounded";
  isLight?: boolean;
  colorblindFriendly?: boolean;
}

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_SYMBOLS: SymbolSet = {
  success: "✓",
  error: "✗",
  warning: "⚠",
  info: "ℹ",
  question: "?",
  bullet: "•",
  pointer: "❯",
  arrowRight: "→",
  arrowLeft: "←",
  arrowUp: "↑",
  arrowDown: "↓",
  checkboxOn: "◉",
  checkboxOff: "○",
  radioOn: "◉",
  radioOff: "○",
  progressFilled: "█",
  progressEmpty: "░",
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  ellipsis: "…",
  lightning: "⚡",
  gitBranch: "",
  folder: "",
  file: "",
};

export const ASCII_SYMBOLS: SymbolSet = {
  success: "[+]",
  error: "[x]",
  warning: "[!]",
  info: "[i]",
  question: "[?]",
  bullet: "*",
  pointer: ">",
  arrowRight: "->",
  arrowLeft: "<-",
  arrowUp: "^",
  arrowDown: "v",
  checkboxOn: "[*]",
  checkboxOff: "[ ]",
  radioOn: "(*)",
  radioOff: "( )",
  progressFilled: "#",
  progressEmpty: "-",
  spinner: ["-", "\\", "|", "/"],
  ellipsis: "...",
  lightning: "*",
  gitBranch: "|",
  folder: "/",
  file: "-",
};

export const BORDER_CHARS: Record<"single" | "double" | "rounded", BorderChars> = {
  single: {
    topLeft: "┌",
    topRight: "┐",
    bottomLeft: "└",
    bottomRight: "┘",
    horizontal: "─",
    vertical: "│",
    teeLeft: "┤",
    teeRight: "├",
    teeTop: "┴",
    teeBottom: "┬",
    cross: "┼",
  },
  double: {
    topLeft: "╔",
    topRight: "╗",
    bottomLeft: "╚",
    bottomRight: "╝",
    horizontal: "═",
    vertical: "║",
    teeLeft: "╣",
    teeRight: "╠",
    teeTop: "╩",
    teeBottom: "╦",
    cross: "╬",
  },
  rounded: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "─",
    vertical: "│",
    teeLeft: "┤",
    teeRight: "├",
    teeTop: "┴",
    teeBottom: "┬",
    cross: "┼",
  },
};
