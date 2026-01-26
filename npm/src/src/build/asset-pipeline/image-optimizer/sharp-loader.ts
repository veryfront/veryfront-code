import { logger } from "../../../utils/index.js";
import { SHARP_CDN_URL } from "./constants.js";
import type { SharpConstructor } from "./types.js";

export async function loadSharp(): Promise<SharpConstructor | null> {
  try {
    const { default: sharp } = await import(SHARP_CDN_URL);
    logger.info("Sharp image optimizer loaded successfully");
    return sharp;
  } catch (error) {
    logger.warn("Sharp not available. Install with: npm install sharp", {
      error: error instanceof Error ? error.message : String(error),
    });
    logger.info("Skipping image optimization. Images will be copied as-is.");
    return null;
  }
}
