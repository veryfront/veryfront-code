/**
 * Banner Component for CLI
 *
 * Polished startup banner with dot matrix logo and info.
 */

import { BORDER_STYLES, box } from "../box.ts";
import { brand, dim, shouldUseColor } from "../colors.ts";
import { AGENT_FACE } from "../dot-matrix.ts";
import { maxLineWidth, pad, repeat } from "../layout.ts";

const RESET = "\x1b[0m";

export interface BannerInfo {
  url?: string;
  project?: string;
  port?: number;
  [key: string]: string | number | undefined;
}

export interface BannerOptions {
  /** Title text (default: "Veryfront") */
  title?: string;
  /** Subtitle text */
  subtitle?: string;
  /** Key-value info to display */
  info?: BannerInfo;
  /** Border style (default: "rounded") */
  style?: keyof typeof BORDER_STYLES;
  /** Minimum width */
  minWidth?: number;
  /** Show the dot matrix logo */
  showLogo?: boolean;
}

/**
 * Render the dot matrix face with colors
 */
function renderLogo(): string[] {
  const litColor = shouldUseColor() ? "\x1b[38;2;0;163;244m" : "";
  const offColor = shouldUseColor() ? "\x1b[38;5;240m" : "";

  const result: string[] = [];
  for (const row of AGENT_FACE) {
    const dots = row.map((dot) => {
      if (dot === 1) {
        return `${litColor}●${RESET}`;
      }
      return `${offColor}○${RESET}`;
    });
    result.push(dots.join(" "));
  }
  return result;
}

/**
 * Create a startup banner with logo and info
 */
export function banner(options: BannerOptions = {}): string {
  const {
    title = "Veryfront",
    subtitle,
    info = {},
    style = "rounded",
    minWidth = 45,
    showLogo = true,
  } = options;

  // Build info lines
  const infoLines: string[] = [];

  // Title line
  infoLines.push(brand(title) + (subtitle ? ` ${dim(subtitle)}` : ""));
  infoLines.push(""); // Spacing

  // Info key-value pairs
  const infoEntries = Object.entries(info).filter(([_, v]) => v !== undefined);
  if (infoEntries.length > 0) {
    const maxKeyLen = Math.max(...infoEntries.map(([k]) => k.length));
    for (const [key, value] of infoEntries) {
      const keyPadded = pad(key.charAt(0).toUpperCase() + key.slice(1), maxKeyLen, "right");
      infoLines.push(`${dim(keyPadded)}  ${brand(String(value))}`);
    }
  }

  // Get logo if showing
  const logoLines = showLogo ? renderLogo() : [];

  // Combine logo and info
  let contentLines: string[];
  if (showLogo && logoLines.length > 0) {
    // Join logo and info horizontally
    const logoWidth = maxLineWidth(logoLines);
    const infoWidth = maxLineWidth(infoLines);
    const gap = 3;

    // Pad to same height, centering vertically
    const maxHeight = Math.max(logoLines.length, infoLines.length);

    const paddedLogo = padVertical(logoLines, maxHeight, logoWidth);
    const paddedInfo = padVertical(infoLines, maxHeight, infoWidth);

    contentLines = [];
    for (let i = 0; i < maxHeight; i++) {
      const logoLine = paddedLogo[i] || "";
      const infoLine = paddedInfo[i] || "";
      contentLines.push(pad(logoLine, logoWidth, "left") + repeat(" ", gap) + infoLine);
    }
  } else {
    contentLines = infoLines;
  }

  const content = contentLines.join("\n");

  // Calculate width
  const contentWidth = maxLineWidth(contentLines);
  const boxWidth = Math.max(minWidth, contentWidth + 4); // +4 for padding

  return box(content, {
    style,
    width: boxWidth,
    paddingX: 2,
    paddingY: 1,
  });
}

/**
 * Pad lines vertically to target height, centered
 */
function padVertical(lns: string[], targetHeight: number, width: number): string[] {
  if (lns.length >= targetHeight) return lns;

  const padCount = targetHeight - lns.length;
  const top = Math.floor(padCount / 2);
  const bottom = padCount - top;

  return [
    ...Array(top).fill(repeat(" ", width)),
    ...lns,
    ...Array(bottom).fill(repeat(" ", width)),
  ];
}

/**
 * Simple banner without box (inline style)
 */
export function inlineBanner(options: BannerOptions = {}): string {
  const {
    title = "Veryfront",
    subtitle,
    info = {},
    showLogo = true,
  } = options;

  const result: string[] = [];

  // Build info text
  const textLines: string[] = [];
  textLines.push(brand(title) + (subtitle ? ` ${dim(subtitle)}` : ""));
  textLines.push("");

  const infoEntries = Object.entries(info).filter(([_, v]) => v !== undefined);
  if (infoEntries.length > 0) {
    const maxKeyLen = Math.max(...infoEntries.map(([k]) => k.length));
    for (const [key, value] of infoEntries) {
      const keyPadded = pad(key.charAt(0).toUpperCase() + key.slice(1), maxKeyLen, "right");
      textLines.push(`${dim(keyPadded)}  ${brand(String(value))}`);
    }
  }

  if (showLogo) {
    // Use the existing getAgentFaceWithText function style
    const logoLines = renderLogo();
    const maxHeight = Math.max(logoLines.length, textLines.length);

    // Center text vertically
    const textStart = Math.floor((maxHeight - textLines.length) / 2);

    for (let i = 0; i < maxHeight; i++) {
      let line = "  " + (logoLines[i] || repeat(" ", 13)); // Logo width is ~13 chars
      const textIndex = i - textStart;
      if (textIndex >= 0 && textIndex < textLines.length) {
        line += "   " + textLines[textIndex];
      }
      result.push(line);
    }
  } else {
    for (const line of textLines) {
      result.push("  " + line);
    }
  }

  return result.join("\n");
}

/**
 * Error banner with helpful suggestion
 */
export function errorBanner(
  message: string,
  suggestion?: string,
): string {
  const errorColor = "\x1b[38;2;239;68;68m"; // Red
  const content: string[] = [];

  content.push(message);
  if (suggestion) {
    content.push("");
    content.push(dim(`Try: ${suggestion}`));
  }

  return box(content.join("\n"), {
    style: "rounded",
    title: "Error",
    titleColor: errorColor,
    borderColor: errorColor,
    paddingX: 2,
    paddingY: 1,
  });
}

/**
 * Success banner
 */
export function successBanner(
  message: string,
  info?: BannerInfo,
): string {
  const successColor = "\x1b[38;2;34;197;94m"; // Green
  const content: string[] = [];

  content.push(message);

  if (info) {
    content.push("");
    const infoEntries = Object.entries(info).filter(([_, v]) => v !== undefined);
    const maxKeyLen = Math.max(...infoEntries.map(([k]) => k.length));
    for (const [key, value] of infoEntries) {
      const keyPadded = pad(key.charAt(0).toUpperCase() + key.slice(1), maxKeyLen, "right");
      content.push(`${dim(keyPadded)}  ${String(value)}`);
    }
  }

  return box(content.join("\n"), {
    style: "rounded",
    title: "✓ Success",
    titleColor: successColor,
    borderColor: successColor,
    paddingX: 2,
    paddingY: 1,
  });
}
