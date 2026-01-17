import React from "react";

export interface GoogleFontsProps {
  fonts: string | string[];
  display?: "auto" | "block" | "swap" | "fallback" | "optional";
}

/**
 * SSR-compatible GoogleFonts component
 * Generates the appropriate link tags for loading Google Fonts
 */
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

export const GoogleFonts: React.FC<GoogleFontsProps> = ({
  fonts,
  display = "swap",
}) => {
  const fontList = Array.isArray(fonts) ? fonts : [fonts];

  // Build the Google Fonts URL
  const fontParam = fontList
    .map((font) => {
      // Normalize font to string, handling objects
      const fontString = normalizeFontToString(font);
      if (!fontString) {
        console.warn("[GoogleFonts] Invalid font format:", font);
        return null;
      }
      // Handle fonts with weights like "Inter:wght@400;500;600"
      const encoded = fontString.replace(/ /g, "+");
      return `family=${encoded}`;
    })
    .filter(Boolean)
    .join("&");

  const href = `https://fonts.googleapis.com/css2?${fontParam}&display=${display}`;

  // For SSR, we return a fragment that will be processed by the shell generator
  // The actual <link> injection happens in the HTML shell
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href={href} />
    </>
  );
};

export default GoogleFonts;
