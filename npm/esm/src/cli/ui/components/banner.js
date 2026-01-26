import { RESET } from "../ansi.js";
import { box } from "../box.js";
import { brand, dim, shouldUseColor } from "../colors.js";
import { AGENT_FACE } from "../dot-matrix.js";
import { maxLineWidth, pad, repeat } from "../layout.js";
function formatInfoLines(info, styleValue = true) {
    const entries = Object.entries(info).filter(([, v]) => v !== undefined);
    if (entries.length === 0)
        return [];
    const maxKeyLen = Math.max(...entries.map(([k]) => k.length));
    return entries.map(([key, value]) => {
        const keyPadded = pad(key.charAt(0).toUpperCase() + key.slice(1), maxKeyLen, "right");
        const formattedValue = styleValue ? brand(String(value)) : String(value);
        return `${dim(keyPadded)}  ${formattedValue}`;
    });
}
function renderLogo() {
    const useColor = shouldUseColor();
    const litColor = useColor ? "\x1b[38;2;252;143;93m" : "";
    const offColor = useColor ? "\x1b[38;5;240m" : "";
    return AGENT_FACE.map((row) => row
        .map((dot) => (dot === 1 ? `${litColor}●${RESET}` : `${offColor}○${RESET}`))
        .join(" "));
}
function padVertical(lines, targetHeight, width) {
    if (lines.length >= targetHeight)
        return lines;
    const padCount = targetHeight - lines.length;
    const top = Math.floor(padCount / 2);
    const bottom = padCount - top;
    const blank = repeat(" ", width);
    return [...Array(top).fill(blank), ...lines, ...Array(bottom).fill(blank)];
}
function buildTextLines(title, subtitle, info) {
    return [brand(title) + (subtitle ? ` ${dim(subtitle)}` : ""), "", ...formatInfoLines(info)];
}
export function banner(options = {}) {
    const { title = "Veryfront", subtitle, info = {}, style = "rounded", minWidth = 45, showLogo = true, } = options;
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
export function inlineBanner(options = {}) {
    const { title = "Veryfront", subtitle, info = {}, showLogo = true } = options;
    const textLines = buildTextLines(title, subtitle, info);
    if (!showLogo)
        return textLines.map((line) => "  " + line).join("\n");
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
export function errorBanner(message, suggestion) {
    const errorColor = "\x1b[38;2;239;68;68m";
    const content = [message];
    if (suggestion)
        content.push("", dim(`Try: ${suggestion}`));
    return box(content.join("\n"), {
        style: "rounded",
        title: "Error",
        titleColor: errorColor,
        borderColor: errorColor,
        paddingX: 2,
        paddingY: 1,
    });
}
export function successBanner(message, info) {
    const successColor = "\x1b[38;2;34;197;94m";
    const content = [message];
    if (info)
        content.push("", ...formatInfoLines(info, false));
    return box(content.join("\n"), {
        style: "rounded",
        title: "✓ Success",
        titleColor: successColor,
        borderColor: successColor,
        paddingX: 2,
        paddingY: 1,
    });
}
