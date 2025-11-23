/**
 * ASCII logo display
 * @module
 */

import { cliLogger } from "@veryfront/utils";
import { formatAsciiLogo } from "./formatters.ts";

/**
 * Displays the Veryfront ASCII logo
 */
export function showAsciiLogo(): void {
  cliLogger.info(formatAsciiLogo());
}
