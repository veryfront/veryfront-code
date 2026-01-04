import React from "react";

export interface GoogleFontsProps {
  fonts: string | string[];
  display?: "auto" | "block" | "swap" | "fallback" | "optional";
}

/**
 * SSR-compatible GoogleFonts component
 * Generates the appropriate link tags for loading Google Fonts
 */
export const GoogleFonts: React.FC<GoogleFontsProps> = ({
  fonts,
  display = "swap",
}) => {
  const fontList = Array.isArray(fonts) ? fonts : [fonts];

  // Build the Google Fonts URL
  const fontParam = fontList
    .map((font) => {
      // Handle fonts with weights like "Inter:wght@400;500;600"
      const encoded = font.replace(/ /g, "+");
      return `family=${encoded}`;
    })
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
