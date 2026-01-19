/**
 * Font exports for veryfront/fonts
 * Provides Google Fonts component that injects into document head
 */
import React from "react";
import { Head } from "../components/Head.tsx";

export interface Font {
  name: string;
  variable?: string;
  weights?: Array<string | number>;
  italics?: boolean;
}

export interface GoogleFontsProps {
  fonts: Array<Font>;
}

function sortMixedArray(arr: Array<string | number>): Array<string | number> {
  return arr.sort((a, b) => {
    const numA = typeof a === "string" ? parseFloat(a) : a;
    const numB = typeof b === "string" ? parseFloat(b) : b;
    if (isNaN(numA) && isNaN(numB)) return 0;
    if (isNaN(numA)) return 1;
    if (isNaN(numB)) return -1;
    return numA - numB;
  });
}

function generateGoogleFontsParam(font: Font): string {
  if (!font) {
    return "";
  }

  const escapedName = font.name.replace(/ /g, "+");

  let param = `family=${escapedName}:`;

  const weights = font.weights ?? [400];
  const sortedWeights = sortMixedArray(weights);

  if (font.italics) {
    param += "ital,";
  }

  const weightParams: Array<string | number> = [];

  if (font.italics) {
    for (const w of sortedWeights) {
      weightParams.push(`0,${w}`);
    }
    for (const w of sortedWeights) {
      weightParams.push(`1,${w}`);
    }
  } else {
    for (const w of sortedWeights) {
      weightParams.push(w);
    }
  }

  param += "wght@" + weightParams.join(";");
  param += "&display=swap";

  return param;
}

function generateGoogleFontsHref(fonts: Array<Font>): string {
  if (!fonts?.length) {
    return "";
  }

  const families = fonts.map(generateGoogleFontsParam).join("&");
  return `https://fonts.googleapis.com/css2?${families}`;
}

function generateCssVariables(fonts: Array<Font>): string {
  const variables = fonts
    .filter((font) => !!font.variable)
    .map((font) => `    ${font.variable}: "${font.name}", ui-sans-serif, system-ui, sans-serif;`)
    .join("\n");

  if (!variables) {
    return "";
  }

  return `
@layer base {
  :root {
${variables}
  }
}`.trim();
}

/**
 * GoogleFonts component - loads Google Fonts and generates CSS variables
 *
 * Usage:
 *   <GoogleFonts fonts={[
 *     { name: "Inter", variable: "--font-sans", weights: [400, 500, 600, 700] },
 *     { name: "Inter", variable: "--font-display", weights: [600, 700] },
 *   ]} />
 */
export function GoogleFonts({ fonts = [] }: GoogleFontsProps) {
  const href = generateGoogleFontsHref(fonts);
  const cssVariables = generateCssVariables(fonts);

  return React.createElement(
    Head,
    null,
    React.createElement("link", { rel: "preconnect", href: "https://fonts.googleapis.com" }),
    React.createElement("link", {
      rel: "preconnect",
      href: "https://fonts.gstatic.com",
      crossOrigin: "anonymous",
    }),
    href && React.createElement("link", { href, rel: "stylesheet" }),
    cssVariables && React.createElement("style", null, cssVariables),
  );
}

export default GoogleFonts;
