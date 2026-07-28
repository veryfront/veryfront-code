import { logger } from "#veryfront/utils";
import { DEPENDENCY_MISSING } from "#veryfront/errors";
import { SHARP_MODULE_SPECIFIER } from "./constants.ts";
import type { SharpConstructor } from "./types.ts";

export async function loadSharp(): Promise<SharpConstructor> {
  try {
    const { default: sharp } = await import(SHARP_MODULE_SPECIFIER);
    if (typeof sharp !== "function") {
      throw new TypeError("Sharp module did not export an image constructor");
    }
    logger.info("Sharp image optimizer loaded successfully");
    return sharp as unknown as SharpConstructor;
  } catch (error) {
    throw DEPENDENCY_MISSING.create({
      detail: `Image optimization requires ${SHARP_MODULE_SPECIFIER}`,
      cause: error,
    });
  }
}
