import { logger } from "#veryfront/utils";
import { SHARP_MODULE_SPECIFIER } from "./constants.ts";
import type { SharpConstructor } from "./types.ts";
import { BUILD_FAILED } from "#veryfront/errors";

export async function loadSharp(): Promise<SharpConstructor> {
  try {
    const { default: sharp } = await import(SHARP_MODULE_SPECIFIER);
    logger.info("Sharp image optimizer loaded successfully");
    return sharp;
  } catch (error) {
    throw BUILD_FAILED.create({
      detail: "Image optimization requires Sharp. Install it with: npm install sharp",
      cause: error,
    });
  }
}
