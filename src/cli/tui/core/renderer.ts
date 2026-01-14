// deno-lint-ignore-file no-explicit-any
/**
 * TUI Renderer
 *
 * Double-buffered ANSI terminal renderer for flicker-free updates.
 * Performs diff-based rendering to minimize terminal output.
 *
 * @note Type assertions used for cross-runtime compatibility with Node.js/Bun.
 */

declare const process: any;

import {
  BOX_CHARS,
  clearScreen,
  cursorHide,
  cursorShow,
  cursorTo,
  stripAnsi,
  write,
} from "./ansi.ts";
import { stringWidth } from "../utils/unicode.ts";
import { getTerminalSize, type TerminalSize } from "../utils/terminal.ts";
import type { Theme } from "../themes/types.ts";
import { defaultTheme } from "../themes/default.ts";

// ============================================================================
// Types
// ============================================================================

export interface Cell {
  /** Character to display */
  char: string;
  /** Foreground color (ANSI code or hex) */
  fg?: string;
  /** Background color (ANSI code or hex) */
  bg?: string;
  /** Text is bold */
  bold?: boolean;
  /** Text is dim */
  dim?: boolean;
  /** Text is italic */
  italic?: boolean;
  /** Text is underlined */
  underline?: boolean;
  /** Text is inverted */
  inverse?: boolean;
}

export interface RenderContext {
  /** Terminal width in columns */
  width: number;
  /** Terminal height in rows */
  height: number;
  /** 2D buffer of cells */
  buffer: Cell[][];
  /** Current theme */
  theme: Theme;
  /** Whether to use colors */
  useColor: boolean;
}

export interface RenderOptions {
  /** Initial theme */
  theme?: Theme;
  /** Force color mode (overrides detection) */
  forceColor?: boolean;
  /** Use alternate screen buffer */
  alternateScreen?: boolean;
}

// ============================================================================
// Cell Utilities
// ============================================================================

function createEmptyCell(): Cell {
  return { char: " " };
}

function cellsEqual(a: Cell, b: Cell): boolean {
  return (
    a.char === b.char &&
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.inverse === b.inverse
  );
}

function cellToAnsi(cell: Cell, useColor: boolean): string {
  if (!useColor) {
    return cell.char;
  }

  let result = "";
  const codes: number[] = [];

  if (cell.bold) codes.push(1);
  if (cell.dim) codes.push(2);
  if (cell.italic) codes.push(3);
  if (cell.underline) codes.push(4);
  if (cell.inverse) codes.push(7);

  // Simple ANSI color names to codes
  if (cell.fg) {
    const fgCode = colorNameToCode(cell.fg, false);
    if (fgCode) codes.push(fgCode);
  }

  if (cell.bg) {
    const bgCode = colorNameToCode(cell.bg, true);
    if (bgCode) codes.push(bgCode);
  }

  if (codes.length > 0) {
    result += `\x1b[${codes.join(";")}m`;
  }

  result += cell.char;

  if (codes.length > 0) {
    result += "\x1b[0m";
  }

  return result;
}

function colorNameToCode(color: string, isBackground: boolean): number | null {
  const offset = isBackground ? 10 : 0;

  switch (color) {
    case "black":
      return 30 + offset;
    case "red":
      return 31 + offset;
    case "green":
      return 32 + offset;
    case "yellow":
      return 33 + offset;
    case "blue":
      return 34 + offset;
    case "magenta":
      return 35 + offset;
    case "cyan":
      return 36 + offset;
    case "white":
      return 37 + offset;
    case "gray":
    case "grey":
      return 90 + offset;
    default:
      return null;
  }
}

// ============================================================================
// Buffer Management
// ============================================================================

function createBuffer(width: number, height: number): Cell[][] {
  const buffer: Cell[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < width; x++) {
      row.push(createEmptyCell());
    }
    buffer.push(row);
  }
  return buffer;
}

function clearBuffer(buffer: Cell[][]): void {
  for (const row of buffer) {
    for (let x = 0; x < row.length; x++) {
      row[x] = createEmptyCell();
    }
  }
}

// ============================================================================
// Renderer Class
// ============================================================================

export class TUIRenderer {
  private frontBuffer: Cell[][] = [];
  private backBuffer: Cell[][] = [];
  private width = 0;
  private height = 0;
  private theme: Theme;
  private useColor: boolean;
  private alternateScreen: boolean;
  private cursorVisible = true;
  private initialized = false;

  constructor(options: RenderOptions = {}) {
    this.theme = options.theme ?? defaultTheme;
    this.useColor = options.forceColor ?? this.detectColorSupport();
    this.alternateScreen = options.alternateScreen ?? false;
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Initialize the renderer
   */
  init(): void {
    if (this.initialized) return;

    const size = getTerminalSize();
    this.resize(size.columns, size.rows);

    if (this.alternateScreen) {
      write("\x1b[?1049h"); // Enter alternate screen
    }

    this.hideCursor();
    this.initialized = true;
  }

  /**
   * Cleanup and restore terminal state
   */
  cleanup(): void {
    if (!this.initialized) return;

    this.showCursor();

    if (this.alternateScreen) {
      write("\x1b[?1049l"); // Exit alternate screen
    }

    write("\x1b[0m"); // Reset all attributes
    this.initialized = false;
  }

  /**
   * Resize buffers to match new terminal size
   */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.frontBuffer = createBuffer(width, height);
    this.backBuffer = createBuffer(width, height);
  }

  // ============================================================================
  // Drawing API
  // ============================================================================

  /**
   * Get the back buffer for drawing
   */
  getContext(): RenderContext {
    return {
      width: this.width,
      height: this.height,
      buffer: this.backBuffer,
      theme: this.theme,
      useColor: this.useColor,
    };
  }

  /**
   * Clear the back buffer
   */
  clear(): void {
    clearBuffer(this.backBuffer);
  }

  /**
   * Set a cell in the back buffer
   */
  setCell(x: number, y: number, cell: Cell): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    this.backBuffer[y][x] = cell;
  }

  /**
   * Write a character at position
   */
  putChar(x: number, y: number, char: string, style: Partial<Cell> = {}): void {
    this.setCell(x, y, { char, ...style });
  }

  /**
   * Write text at position
   */
  putText(x: number, y: number, text: string, style: Partial<Cell> = {}): void {
    // Strip ANSI codes for positioning, but we could parse them for styling
    const stripped = stripAnsi(text);
    let col = x;

    for (const char of stripped) {
      if (col >= this.width) break;
      this.putChar(col, y, char, style);
      col += stringWidth(char);
    }
  }

  /**
   * Draw a horizontal line
   */
  hline(x: number, y: number, length: number, char = "─", style: Partial<Cell> = {}): void {
    for (let i = 0; i < length && x + i < this.width; i++) {
      this.putChar(x + i, y, char, style);
    }
  }

  /**
   * Draw a vertical line
   */
  vline(x: number, y: number, length: number, char = "│", style: Partial<Cell> = {}): void {
    for (let i = 0; i < length && y + i < this.height; i++) {
      this.putChar(x, y + i, char, style);
    }
  }

  /**
   * Draw a box
   */
  box(
    x: number,
    y: number,
    width: number,
    height: number,
    borderStyle: "single" | "double" | "rounded" = "rounded",
    style: Partial<Cell> = {},
  ): void {
    const chars = BOX_CHARS[borderStyle];

    // Corners
    this.putChar(x, y, chars.topLeft, style);
    this.putChar(x + width - 1, y, chars.topRight, style);
    this.putChar(x, y + height - 1, chars.bottomLeft, style);
    this.putChar(x + width - 1, y + height - 1, chars.bottomRight, style);

    // Top and bottom borders
    this.hline(x + 1, y, width - 2, chars.horizontal, style);
    this.hline(x + 1, y + height - 1, width - 2, chars.horizontal, style);

    // Left and right borders
    this.vline(x, y + 1, height - 2, chars.vertical, style);
    this.vline(x + width - 1, y + 1, height - 2, chars.vertical, style);
  }

  /**
   * Fill a rectangular region
   */
  fill(
    x: number,
    y: number,
    width: number,
    height: number,
    char = " ",
    style: Partial<Cell> = {},
  ): void {
    for (let row = y; row < y + height && row < this.height; row++) {
      for (let col = x; col < x + width && col < this.width; col++) {
        this.putChar(col, row, char, style);
      }
    }
  }

  // ============================================================================
  // Rendering
  // ============================================================================

  /**
   * Commit back buffer to screen (diff-based update)
   */
  commit(): void {
    let output = "";
    let lastX = -1;
    let lastY = -1;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const front = this.frontBuffer[y]?.[x];
        const back = this.backBuffer[y]?.[x];

        if (!front || !back) continue;

        if (!cellsEqual(front, back)) {
          // Need to update this cell
          if (lastX !== x - 1 || lastY !== y) {
            // Need to move cursor
            output += cursorTo(x + 1, y + 1);
          }

          output += cellToAnsi(back, this.useColor);

          // Update front buffer
          this.frontBuffer[y][x] = { ...back };
          lastX = x;
          lastY = y;
        }
      }
    }

    if (output) {
      write(output);
    }
  }

  /**
   * Force full redraw (ignores diff)
   */
  forceRedraw(): void {
    let output = clearScreen + cursorTo(1, 1);

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.backBuffer[y]?.[x];
        if (cell) {
          output += cellToAnsi(cell, this.useColor);
          this.frontBuffer[y][x] = { ...cell };
        }
      }
      if (y < this.height - 1) {
        output += "\n";
      }
    }

    write(output);
  }

  // ============================================================================
  // Cursor Control
  // ============================================================================

  hideCursor(): void {
    if (this.cursorVisible) {
      write(cursorHide);
      this.cursorVisible = false;
    }
  }

  showCursor(): void {
    if (!this.cursorVisible) {
      write(cursorShow);
      this.cursorVisible = true;
    }
  }

  // ============================================================================
  // Theme
  // ============================================================================

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  getTheme(): Theme {
    return this.theme;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  getSize(): TerminalSize {
    return { columns: this.width, rows: this.height };
  }

  private detectColorSupport(): boolean {
    // Check NO_COLOR
    const noColor = this.getEnv("NO_COLOR");
    if (noColor !== undefined && noColor !== "") {
      return false;
    }

    // Check FORCE_COLOR
    const forceColor = this.getEnv("FORCE_COLOR");
    if (forceColor !== undefined && forceColor !== "0") {
      return true;
    }

    // Check if TTY
    if (typeof Deno !== "undefined") {
      // @ts-ignore - Deno global
      return Deno.stdout?.isTerminal?.() ?? false;
    }

    if (typeof process !== "undefined") {
      return process.stdout?.isTTY ?? false;
    }

    return false;
  }

  private getEnv(name: string): string | undefined {
    if (typeof Deno !== "undefined") {
      // @ts-ignore - Deno global
      return Deno.env?.get?.(name);
    }
    return process?.env?.[name];
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let _renderer: TUIRenderer | null = null;

/**
 * Get or create the singleton renderer instance
 */
export function getRenderer(options?: RenderOptions): TUIRenderer {
  if (!_renderer) {
    _renderer = new TUIRenderer(options);
  }
  return _renderer;
}

/**
 * Destroy the singleton renderer instance
 */
export function destroyRenderer(): void {
  if (_renderer) {
    _renderer.cleanup();
    _renderer = null;
  }
}
