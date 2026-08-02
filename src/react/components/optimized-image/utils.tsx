import type { CSSProperties, ReactElement, ReactNode } from "react";

const MAX_BLUR_COLOR_CHARS = 1_024;

function assertPositiveDimension(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite number`);
  }
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "'":
        return "&apos;";
      default:
        return "&quot;";
    }
  });
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function containsForbiddenXmlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (
      codePoint <= 0x08 ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      codePoint === 0xfffe ||
      codePoint === 0xffff
    ) {
      return true;
    }
  }
  return false;
}

export function generateBlurDataURL(
  width: number = 10,
  height: number = 10,
  color: string = "#cccccc",
): string {
  assertPositiveDimension(width, "Blur image width");
  assertPositiveDimension(height, "Blur image height");
  if (typeof color !== "string" || color.length === 0) {
    throw new TypeError("Blur image color must be a non-empty string");
  }
  if (color.length > MAX_BLUR_COLOR_CHARS) {
    throw new TypeError(
      `Blur image color must not exceed ${MAX_BLUR_COLOR_CHARS} characters`,
    );
  }
  if (
    containsForbiddenXmlCharacter(color) ||
    /\burl\s*\(/iu.test(color)
  ) {
    throw new TypeError(
      "Blur image color must not contain XML control characters or resource URLs",
    );
  }

  const escapedColor = escapeXmlAttribute(color);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${escapedColor}"/></svg>`;
  return `data:image/svg+xml;base64,${encodeBase64Utf8(svg)}`;
}

export function getAspectRatioPadding(width: number, height: number): string {
  assertPositiveDimension(width, "Image width");
  assertPositiveDimension(height, "Image height");
  return `${(height / width) * 100}%`;
}

export function ResponsiveImageContainer({
  width,
  height,
  children,
  className,
  style,
}: {
  width: number;
  height: number;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}): ReactElement {
  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: "100%",
        paddingBottom: getAspectRatioPadding(width, height),
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
        }}
      >
        {children}
      </div>
    </div>
  );
}
