/**
 * Font exports for veryfront/fonts
 * Provides Google Fonts component
 */
import React from "react";

export interface GoogleFontsProps {
  fonts: string | string[];
  display?: "auto" | "block" | "swap" | "fallback" | "optional";
}

/**
 * Normalize font input to a string format for Google Fonts URL
 * Handles various input formats:
 * - string: "Inter" or "Inter:wght@400;500"
 * - object: { family: "Inter", weight: 400 } or { name: "Inter" }
 */
function normalizeFontToString(font: unknown): string | null {
  if (typeof font === "string") {
    return font;
  }
  if (font && typeof font === "object") {
    const fontObj = font as Record<string, unknown>;
    // Handle { family: "Inter" } or { name: "Inter" } formats
    const family = fontObj.family || fontObj.name;
    if (typeof family === "string") {
      // Optionally append weight if present
      const weight = fontObj.weight || fontObj.weights;
      if (weight) {
        const weightStr = Array.isArray(weight) ? weight.join(";") : String(weight);
        return `${family}:wght@${weightStr}`;
      }
      return family;
    }
  }
  return null;
}

export function GoogleFonts({ fonts, display = "swap" }: GoogleFontsProps) {
  const fontList = Array.isArray(fonts) ? fonts : [fonts];
  const fontParam = fontList
    .map((font) => {
      // Normalize font to string, handling objects
      const fontString = normalizeFontToString(font);
      if (!fontString) {
        console.warn("[GoogleFonts] Invalid font format:", font);
        return null;
      }
      const encoded = fontString.replace(/ /g, "+");
      return `family=${encoded}`;
    })
    .filter(Boolean)
    .join("&");

  const href = `https://fonts.googleapis.com/css2?${fontParam}&display=${display}`;

  return React.createElement(
    React.Fragment,
    null,
    React.createElement("link", { rel: "preconnect", href: "https://fonts.googleapis.com" }),
    React.createElement("link", {
      rel: "preconnect",
      href: "https://fonts.gstatic.com",
      crossOrigin: "",
    }),
    React.createElement("link", { rel: "stylesheet", href }),
  );
}

export default GoogleFonts;
