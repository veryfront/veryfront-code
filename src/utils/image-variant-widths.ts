import { IMAGE_OPTIMIZATION } from "#veryfront/utils/constants/build.ts";

const apply = Reflect.apply;
const arrayPush = Array.prototype.push;
const arraySort = Array.prototype.sort;
const freeze = Object.freeze;
const isSafeInteger = Number.isSafeInteger;
const MAX_IMAGE_DIMENSION = IMAGE_OPTIMIZATION.MAX_DIMENSION;
const NativeTypeError = TypeError;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const SetConstructor = Set;
const DEFAULT_IMAGE_WIDTHS = freeze([...IMAGE_OPTIMIZATION.DEFAULT_SIZES]);

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
