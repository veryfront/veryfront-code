/**
 * React Fonts
 *
 * @module react/fonts
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

    const aNaN = Number.isNaN(numA);
    const bNaN = Number.isNaN(numB);

    if (aNaN && bNaN) return 0;
    if (aNaN) return 1;
    if (bNaN) return -1;
    return numA - numB;
  });
}

function generateGoogleFontsParam(font: Font): string {
  const escapedName = font.name.replace(/ /g, "+");
  const sortedWeights = sortMixedArray(font.weights ?? [400]);

  const weightParams: Array<string | number> = [];

  if (font.italics) {
    for (const w of sortedWeights) weightParams.push(`0,${w}`);
    for (const w of sortedWeights) weightParams.push(`1,${w}`);
    return `family=${escapedName}:ital,wght@${weightParams.join(";")}&display=swap`;
  }

  for (const w of sortedWeights) weightParams.push(w);
  return `family=${escapedName}:wght@${weightParams.join(";")}&display=swap`;
}

function generateGoogleFontsHref(fonts: Array<Font>): string {
  if (!fonts.length) return "";
  return `https://fonts.googleapis.com/css2?${fonts.map(generateGoogleFontsParam).join("&")}`;
}

function generateCssVariables(fonts: Array<Font>): string {
  const variables = fonts
    .filter((font) => font.variable)
    .map((font) => `    ${font.variable}: "${font.name}", ui-sans-serif, system-ui, sans-serif;`)
    .join("\n");

  if (!variables) return "";

  return `
@layer base {
  :root {
${variables}
  }
}`.trim();
}

export function GoogleFonts({ fonts = [] }: GoogleFontsProps): React.ReactElement {
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
    href ? React.createElement("link", { href, rel: "stylesheet" }) : null,
    cssVariables ? React.createElement("style", null, cssVariables) : null,
  );
}
