import { RESET } from "../ansi.ts";
import { BORDER_STYLES, box } from "../box.ts";
import { brand, dim, shouldUseColor } from "../colors.ts";
import { AGENT_FACE } from "../dot-matrix.ts";
import { maxLineWidth, pad, repeat } from "../layout.ts";

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

function formatInfoLines(info: BannerInfo, styleValue = true): string[] {
  const entries = Object.entries(info).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return [];

  const maxKeyLen = Math.max(...entries.map(([k]) => k.length));

  return entries.map(([key, value]) => {
    const keyPadded = pad(key.charAt(0).toUpperCase() + key.slice(1), maxKeyLen, "right");
    const formattedValue = styleValue ? brand(String(value)) : String(value);
    return `${dim(keyPadded)}  ${formattedValue}`;
  });
}

function renderLogo(): string[] {
  const useColor = shouldUseColor();
  const litColor = useColor ? "\x1b[38;2;0;163;244m" : "";
  const offColor = useColor ? "\x1b[38;5;240m" : "";

  return AGENT_FACE.map((row) =>
    row
      .map((dot) => (dot === 1 ? `${litColor}●${RESET}` : `${offColor}○${RESET}`))
      .join(" ")
  );
}

function padVertical(lines: string[], targetHeight: number, width: number): string[] {
  if (lines.length >= targetHeight) return lines;

  const padCount = targetHeight - lines.length;
  const top = Math.floor(padCount / 2);
  const bottom = padCount - top;
  const blank = repeat(" ", width);

  return [...Array(top).fill(blank), ...lines, ...Array(bottom).fill(blank)];
}

function buildTextLines(title: string, subtitle: string | undefined, info: BannerInfo): string[] {
  return [brand(title) + (subtitle ? ` ${dim(subtitle)}` : ""), "", ...formatInfoLines(info)];
}

export function banner(options: BannerOptions = {}): string {
  const {
    title = "Veryfront",
    subtitle,
    info = {},
    style = "rounded",
    minWidth = 45,
    showLogo = true,
  } = options;

  const infoLines = buildTextLines(title, subtitle, info);

  let contentLines = infoLines;
  if (showLogo) {
    const logoLines = renderLogo();
    if (logoLines.length > 0) {
      const logoWidth = maxLineWidth(logoLines);
      const infoWidth = maxLineWidth(infoLines);
      const gap = 3;

      const maxHeight = Math.max(logoLines.length, infoLines.length);
      const paddedLogo = padVertical(logoLines, maxHeight, logoWidth);
      const paddedInfo = padVertical(infoLines, maxHeight, infoWidth);

      contentLines = Array.from({ length: maxHeight }, (_, i) => {
        const logoLine = paddedLogo[i] ?? "";
        const infoLine = paddedInfo[i] ?? "";
        return pad(logoLine, logoWidth, "left") + repeat(" ", gap) + infoLine;
      });
    }
  }

  const contentWidth = maxLineWidth(contentLines);
  const boxWidth = Math.max(minWidth, contentWidth + 4);

  return box(contentLines.join("\n"), {
    style,
    width: boxWidth,
    paddingX: 2,
    paddingY: 1,
  });
}

export function inlineBanner(options: BannerOptions = {}): string {
  const { title = "Veryfront", subtitle, info = {}, showLogo = true } = options;

  const textLines = buildTextLines(title, subtitle, info);
  if (!showLogo) return textLines.map((line) => "  " + line).join("\n");

  const logoLines = renderLogo();
  const maxHeight = Math.max(logoLines.length, textLines.length);
  const textStart = Math.floor((maxHeight - textLines.length) / 2);

  const lines = Array.from({ length: maxHeight }, (_, i) => {
    let line = "  " + (logoLines[i] ?? repeat(" ", 13));
    const textIndex = i - textStart;
    if (textIndex >= 0 && textIndex < textLines.length) {
      line += "   " + textLines[textIndex];
    }
    return line;
  });

  return lines.join("\n");
}

export function errorBanner(message: string, suggestion?: string): string {
  const errorColor = "\x1b[38;2;239;68;68m";
  const content: string[] = [message];

  if (suggestion) content.push("", dim(`Try: ${suggestion}`));

  return box(content.join("\n"), {
    style: "rounded",
    title: "Error",
    titleColor: errorColor,
    borderColor: errorColor,
    paddingX: 2,
    paddingY: 1,
  });
}

export function successBanner(message: string, info?: BannerInfo): string {
  const successColor = "\x1b[38;2;34;197;94m";
  const content: string[] = [message];

  if (info) content.push("", ...formatInfoLines(info, false));

  return box(content.join("\n"), {
    style: "rounded",
    title: "✓ Success",
    titleColor: successColor,
    borderColor: successColor,
    paddingX: 2,
    paddingY: 1,
  });
}
