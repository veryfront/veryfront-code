import { logger } from "@veryfront/utils";
import { SHARP_CDN_URL } from "./constants.ts";
import type { SharpConstructor } from "./types.ts";

export async function loadSharp(): Promise<SharpConstructor | null> {
  try {
    const sharpModule = await import(SHARP_CDN_URL);
    logger.info("Sharp image optimizer loaded successfully");
    return sharpModule.default;
  } catch (error) {
    logger.warn("Sharp not available. Install with: npm install sharp", {
      error: error instanceof Error ? error.message : String(error),
    });
    logger.info("Skipping image optimization. Images will be copied as-is.");
    return null;
  }
}
