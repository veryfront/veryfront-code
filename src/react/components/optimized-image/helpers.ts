import type * as React from "react";
import { isDevelopment } from "#veryfront/platform/environment.ts";
import { getExtensionName } from "#veryfront/utils/path-utils.ts";
import {
  getOptimizableImageSourceExtension,
  isValidImageVariantWidth,
  resolveImageVariantWidths,
} from "#veryfront/utils/image-variant-widths.ts";

export const DEFAULT_OPTIMIZED_IMAGE_FORMATS = ["avif", "webp", "jpeg"] as const;

interface VeryfrontImageRuntimeGlobal {
  __RSC_DEV__?: boolean;
  __VERYFRONT_DEV__?: boolean;
  __VERYFRONT_SSR__?: boolean;
}

const INVALID_IMAGE_DIMENSIONS_WARNING =
  "[Veryfront] Optimized image width and targetWidths must contain positive integers " +
  "within the build image limit. Rendering the original asset instead.";

let warnedInvalidImageDimensions = false;

function isOptimizedImageDevelopment(): boolean {
  const runtime = globalThis as VeryfrontImageRuntimeGlobal;
  const isServer = runtime.__VERYFRONT_SSR__ === true || typeof window === "undefined";
  if (isServer) return isDevelopment();
  return runtime.__VERYFRONT_DEV__ === true || runtime.__RSC_DEV__ === true;
}

function warnInvalidImageDimensionsOnce(): void {
  if (warnedInvalidImageDimensions || !isOptimizedImageDevelopment()) return;
  warnedInvalidImageDimensions = true;
  console.warn(INVALID_IMAGE_DIMENSIONS_WARNING);
}

function sourcePath(src: string): string {
  const queryIndex = src.indexOf("?");
  const fragmentIndex = src.indexOf("#");
  let suffixIndex = src.length;
  if (queryIndex >= 0) suffixIndex = queryIndex;
  if (fragmentIndex >= 0 && fragmentIndex < suffixIndex) suffixIndex = fragmentIndex;
  return src.slice(0, suffixIndex).replaceAll("\\", "/");
}

function encodedAppAssetPath(src: string): string | null {
  if (!src.startsWith("/") || src.startsWith("//") || src.includes("\\")) {
    return null;
  }

  const path = sourcePath(src);
  const segments = path.slice(1).split("/");
  if (segments.length === 0) return null;

  const encodedSegments: string[] = [];
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    if (segment.length === 0) return null;

    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    decoded = decoded.normalize("NFC");
    if (
      decoded === "." || decoded === ".." || decoded.includes("/") ||
      decoded.includes("\\") || decoded.includes("\0")
    ) {
      return null;
    }
    try {
      encodedSegments.push(encodeURIComponent(decoded));
    } catch {
      return null;
    }
  }

  if (getOptimizableImageSourceExtension(encodedSegments[encodedSegments.length - 1]!) === null) {
    return null;
  }

  return `/${encodedSegments.join("/")}`;
}

/** Serialize a URL as a quoted CSS url() value without changing its identity. */
export function cssUrl(value: string): string {
  let escaped = "";
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    const code = value.charCodeAt(index);
    if (code === 0) {
      escaped += "\\fffd ";
    } else if (code <= 0x1f || code === 0x7f) {
      escaped += `\\${code.toString(16)} `;
    } else if (character === '"' || character === "\\") {
      escaped += `\\${character}`;
    } else {
      escaped += character;
    }
  }
  return `url("${escaped}")`;
}

function optimizedPath(src: string, format: string, size: number): string | null {
  const encodedPath = encodedAppAssetPath(src);
  if (encodedPath === null) return null;
  const basePath = encodedPath.replace(/\.[^./]+$/, "");
  return `/.veryfront/optimized-images${basePath}-${size}w.${format}`;
}

export function getOptimizedPath(
  src: string,
  format: string,
  size: number,
  _quality: number = 80,
): string {
  return optimizedPath(src, format, size) ?? src;
}

export function generateSrcSet(
  src: string,
  format: string,
  sizes: readonly number[],
  _quality: number,
): string {
  const paths = sizes.map((size) => optimizedPath(src, format, size));
  if (paths.some((path) => path === null)) return "";
  return paths
    .map((path, index) => `${path} ${sizes[index]}w`)
    .join(", ");
}

/**
 * Resolve build-emitted widths at the public React boundary.
 * Invalid runtime props use the original asset; the strict shared resolver
 * remains authoritative for build configuration and internal callers.
 */
export function getOptimizedImageVariantWidths(
  sourceWidth: number | undefined,
  targetWidths?: readonly number[],
  src?: string,
): readonly number[] {
  if (sourceWidth === undefined) return [];
  try {
    if (!isValidImageVariantWidth(sourceWidth)) {
      warnInvalidImageDimensionsOnce();
      return [];
    }
    if (targetWidths !== undefined) {
      for (let index = 0; index < targetWidths.length; index++) {
        if (!isValidImageVariantWidth(targetWidths[index])) {
          warnInvalidImageDimensionsOnce();
          return [];
        }
      }
    }
    if (src !== undefined && encodedAppAssetPath(src) === null) return [];
    return targetWidths === undefined
      ? resolveImageVariantWidths(sourceWidth)
      : resolveImageVariantWidths(sourceWidth, targetWidths);
  } catch {
    warnInvalidImageDimensionsOnce();
    return [];
  }
}

/** Return a valid numeric img dimension attribute, or omit invalid runtime values. */
export function getImageDimensionAttribute(value: number | undefined): number | undefined {
  return isValidImageVariantWidth(value) ? value : undefined;
}

/** Use the original asset unless a corresponding optimized variant is known. */
export function getOptimizedImageFallback(
  src: string,
  format: string,
  widths: readonly number[],
  quality: number,
  preferredWidth?: number,
): string {
  let width = widths[widths.length - 1];
  if (preferredWidth !== undefined) {
    for (let index = 0; index < widths.length; index++) {
      if (widths[index]! >= preferredWidth) {
        width = widths[index];
        break;
      }
    }
  }
  return width === undefined ? src : getOptimizedPath(src, format, width, quality);
}

/** Use an optimized fallback only when `format` is in the caller-requested formats. */
export function getOptimizedImageFormatFallback(
  src: string,
  format: string,
  requestedFormats: readonly string[] | undefined,
  widths: readonly number[],
  quality: number,
): string {
  if (requestedFormats === undefined) return src;
  for (let index = 0; index < requestedFormats.length; index++) {
    if (requestedFormats[index] === format) {
      return getOptimizedImageFallback(src, format, widths, quality);
    }
  }
  return src;
}

/**
 * Get image file extension, defaulting to "jpeg" if none found.
 *
 * "jpg" is normalized to "jpeg" because the build pipeline only emits
 * "jpeg" variants (see SUPPORTED_FORMATS in the image optimizer), so a
 * ".jpg" source would otherwise produce a fallback URL that never exists.
 */
export function getImageExtension(src: string): string {
  const extension = getExtensionName(sourcePath(src)) || "jpeg";
  return extension === "jpg" ? "jpeg" : extension;
}

// Elements holding a pending Space activation. Keyed weakly so an unmounted
// image is never retained by this module.
const spaceArmedImages = new WeakSet<Element>();

/**
 * Keyboard activation for a clickable image, matching how a native button and
 * `ui/list.tsx` behave: Enter fires on keydown, Space is deferred to keyup so
 * moving focus away cancels the pending activation.
 */
export function handleImageActivationKeyDown(
  event: React.KeyboardEvent<HTMLImageElement>,
): void {
  if (event.key === "Enter") {
    event.preventDefault();
    event.currentTarget.click();
    return;
  }

  if (event.key !== " ") return;
  // Block page scrolling now; activate on keyup. Repeated keydowns from OS key
  // repeat must not each fire onClick the way a plain keydown handler would.
  event.preventDefault();
  spaceArmedImages.add(event.currentTarget);
}

/** Companion to {@link handleImageActivationKeyDown}: fires the deferred Space. */
export function handleImageActivationKeyUp(
  event: React.KeyboardEvent<HTMLImageElement>,
): void {
  if (event.key !== " ") return;

  const armed = spaceArmedImages.delete(event.currentTarget);
  if (
    !armed ||
    event.target !== event.currentTarget ||
    event.nativeEvent.isComposing ||
    event.keyCode === 229
  ) {
    return;
  }

  event.preventDefault();
  event.currentTarget.click();
}

/** Companion to {@link handleImageActivationKeyDown}: drops a pending Space. */
export function handleImageActivationBlur(
  event: React.FocusEvent<HTMLImageElement>,
): void {
  spaceArmedImages.delete(event.currentTarget);
}
