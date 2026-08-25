import { IMAGE_OPTIMIZATION } from "#veryfront/utils/constants/build.ts";

const apply = Reflect.apply;
const arrayPush = Array.prototype.push;
const arraySort = Array.prototype.sort;
const freeze = Object.freeze;
const isSafeInteger = Number.isSafeInteger;
const MAX_IMAGE_DIMENSION = IMAGE_OPTIMIZATION.MAX_DIMENSION;
const NativeTypeError = TypeError;
const stringLastIndexOf = String.prototype.lastIndexOf;
const stringSlice = String.prototype.slice;
const stringToLowerCase = String.prototype.toLowerCase;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const SetConstructor = Set;
const DEFAULT_IMAGE_WIDTHS = freeze([...IMAGE_OPTIMIZATION.DEFAULT_SIZES]);

/** Source extensions for which the build pipeline emits optimized variants. */
export const OPTIMIZABLE_IMAGE_SOURCE_EXTENSIONS = freeze(
  [
    "jpg",
    "jpeg",
    "png",
    "webp",
    "avif",
  ] as const,
);

export function isOptimizableImageSourceExtension(extension: string): boolean {
  for (let index = 0; index < OPTIMIZABLE_IMAGE_SOURCE_EXTENSIONS.length; index++) {
    if (extension === OPTIMIZABLE_IMAGE_SOURCE_EXTENSIONS[index]) return true;
  }
  return false;
}

/** Extract a build-supported extension using the same basename rule as path.extname. */
export function getOptimizableImageSourceExtension(path: string): string | null {
  const lastSlash = apply(stringLastIndexOf, path, ["/"]) as number;
  const lastBackslash = apply(stringLastIndexOf, path, ["\\"]) as number;
  const lastSeparator = lastSlash > lastBackslash ? lastSlash : lastBackslash;
  const lastDot = apply(stringLastIndexOf, path, ["."]) as number;
  if (lastDot <= lastSeparator + 1 || lastDot === path.length - 1) return null;

  const extension = apply(
    stringToLowerCase,
    apply(stringSlice, path, [lastDot + 1]) as string,
    [],
  ) as string;
  return isOptimizableImageSourceExtension(extension) ? extension : null;
}

export function isValidImageVariantWidth(value: unknown): value is number {
  return typeof value === "number" &&
    isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_IMAGE_DIMENSION;
}

function assertImageWidth(value: number, label: string): void {
  if (!isValidImageVariantWidth(value)) {
    throw new NativeTypeError(
      `${label} must be a positive integer no larger than ${MAX_IMAGE_DIMENSION}`,
    );
  }
}

/**
 * Resolve the no-enlargement width matrix emitted by image optimization.
 * Configured widths above the intrinsic source width are omitted, and the
 * intrinsic width is always included exactly once.
 */
export function resolveImageVariantWidths(
  sourceWidth: number,
  configuredWidths: readonly number[] = DEFAULT_IMAGE_WIDTHS,
): number[] {
  assertImageWidth(sourceWidth, "Image source width");

  const widths: number[] = [];
  const seen = new SetConstructor<number>();
  for (let index = 0; index < configuredWidths.length; index++) {
    const width = configuredWidths[index]!;
    assertImageWidth(width, "Configured image width");
    if (width <= sourceWidth && !apply(setHas, seen, [width])) {
      apply(setAdd, seen, [width]);
      apply(arrayPush, widths, [width]);
    }
  }
  if (!apply(setHas, seen, [sourceWidth])) {
    apply(arrayPush, widths, [sourceWidth]);
  }
  apply(arraySort, widths, [(left: number, right: number) => left - right]);
  return widths;
}
