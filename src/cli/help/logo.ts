
import { cliLogger } from "@veryfront/utils";
import { formatAsciiLogo } from "./formatters.ts";

export function showAsciiLogo(): void {
  cliLogger.info(formatAsciiLogo());
}
