/**
 * Load Google Fonts as a React component.
 *
 * @module fonts
 *
 * @example
 * ```tsx
 * import { GoogleFonts } from "veryfront/fonts";
 *
 * <GoogleFonts
 *   fonts={[
 *     { name: "Inter", weights: [400, 500, 700], variable: "--font-inter" },
 *     { name: "Fira Code", weights: [400], variable: "--font-mono" },
 *   ]}
 * />
 * ```
 */

import React from "react";
import { Head } from "../components/Head.tsx";

/** Public API contract for font. */
export interface Font {
  name: string;
  variable?: string;
  weights?: readonly (string | number)[];
  italics?: boolean;
}

/** Props accepted by Google fonts. */
export interface GoogleFontsProps {
  fonts: readonly Font[];
}

const GOOGLE_FONTS_BASE_URL = "https://fonts.googleapis.com/css2";
const FONT_WEIGHT_MIN = 1;
const FONT_WEIGHT_MAX = 1000;
const FONT_WEIGHT_NUMBER_PATTERN = /^\d+(?:\.\d+)?$/;
const CSS_CUSTOM_PROPERTY_PATTERN = /^--[a-zA-Z0-9_-]+$/;

interface NormalizedWeight {
  readonly value: string;
  readonly lower: number;
  readonly upper: number;
  readonly originalIndex: number;
}

function parseWeightNumber(value: string): number {
  if (!FONT_WEIGHT_NUMBER_PATTERN.test(value)) {
    throw new TypeError(`Invalid Google font weight: ${JSON.stringify(value)}`);
  }

  const numericValue = Number(value);
  if (
    !Number.isFinite(numericValue) ||
    numericValue < FONT_WEIGHT_MIN ||
    numericValue > FONT_WEIGHT_MAX
  ) {
    throw new RangeError(
      `Google font weight must be between ${FONT_WEIGHT_MIN} and ${FONT_WEIGHT_MAX}`,
    );
  }

  return numericValue;
}

function normalizeWeight(
  weight: string | number,
  originalIndex: number,
): NormalizedWeight {
  if (typeof weight === "number") {
    if (
      !Number.isFinite(weight) ||
      weight < FONT_WEIGHT_MIN ||
      weight > FONT_WEIGHT_MAX
    ) {
      throw new RangeError(
        `Google font weight must be between ${FONT_WEIGHT_MIN} and ${FONT_WEIGHT_MAX}`,
      );
    }

    return {
      value: String(weight),
      lower: weight,
      upper: weight,
      originalIndex,
    };
  }
  if (typeof weight !== "string") {
    throw new TypeError("Google font weights must be strings or numbers");
  }

  const rangeParts = weight.split("..");
  if (rangeParts.length > 2) {
    throw new TypeError(`Invalid Google font weight: ${JSON.stringify(weight)}`);
  }

  const [lowerPart, upperPart] = rangeParts;
  if (lowerPart === undefined) {
    throw new TypeError(`Invalid Google font weight: ${JSON.stringify(weight)}`);
  }

  const lower = parseWeightNumber(lowerPart);
  const upper = upperPart === undefined ? lower : parseWeightNumber(upperPart);
  if (lower > upper) {
    throw new RangeError("Google font weight ranges must be ordered from low to high");
  }

  return {
    value: upperPart === undefined ? String(lower) : `${lower}..${upper}`,
    lower,
    upper,
    originalIndex,
  };
}

function normalizeWeights(
  weights: readonly (string | number)[] | undefined,
): readonly string[] {
  const input = weights ?? [400];
  if (!Array.isArray(input)) {
    throw new TypeError("Google font weights must be an array");
  }
  if (input.length === 0) {
    throw new RangeError("Google font weights must not be empty");
  }

  // Array.from deliberately severs ownership before sort so even frozen and
  // readonly caller arrays are never mutated.
  const normalized = Array.from(input, normalizeWeight);
  normalized.sort((a, b) =>
    a.lower - b.lower ||
    a.upper - b.upper ||
    a.originalIndex - b.originalIndex
  );

  let previous: NormalizedWeight | undefined;
  for (const current of normalized) {
    if (previous && current.lower <= previous.upper) {
      throw new RangeError("Google font weights must not overlap or repeat");
    }
    previous = current;
  }

  return normalized.map(({ value }) => value);
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      return true;
    }
  }
  return false;
}

function containsUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function encodeFontFamily(name: string): string {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name !== name.trim() ||
    containsControlCharacter(name) ||
    containsUnpairedSurrogate(name)
  ) {
    throw new TypeError("Google font family must be a non-empty, well-formed name");
  }

  return encodeURIComponent(name)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

function escapeCssString(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function validateCssVariable(value: string): string {
  if (
    typeof value !== "string" ||
    !CSS_CUSTOM_PROPERTY_PATTERN.test(value) ||
    value === "--"
  ) {
    throw new TypeError(
      "Google font variable must be a CSS custom property such as --font-body",
    );
  }
  return value;
}

function generateGoogleFontsParam(font: Font): string {
  const escapedName = encodeFontFamily(font.name);
  const sortedWeights = normalizeWeights(font.weights);

  const weightParams: string[] = [];

  if (font.italics) {
    for (const w of sortedWeights) weightParams.push(`0,${w}`);
    for (const w of sortedWeights) weightParams.push(`1,${w}`);
    return `family=${escapedName}:ital,wght@${weightParams.join(";")}`;
  }

  for (const w of sortedWeights) weightParams.push(w);
  return `family=${escapedName}:wght@${weightParams.join(";")}`;
}

function generateGoogleFontsHref(fonts: readonly Font[]): string {
  if (!fonts.length) return "";
  const familyParams = fonts.map(generateGoogleFontsParam).join("&");
  return `${GOOGLE_FONTS_BASE_URL}?${familyParams}&display=swap`;
}

function generateCssVariables(fonts: readonly Font[]): string {
  const variables = fonts
    .filter((font) => font.variable !== undefined)
    .map((font) =>
      `    ${validateCssVariable(font.variable!)}: "${
        escapeCssString(font.name)
      }", ui-sans-serif, system-ui, sans-serif;`
    )
    .join("\n");

  if (!variables) return "";

  return `
@layer base {
  :root {
${variables}
  }
}`.trim();
}

/** Render Google fonts. */
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
