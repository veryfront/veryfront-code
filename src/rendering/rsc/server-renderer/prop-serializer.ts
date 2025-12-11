
import { serverLogger as logger } from "@veryfront/utils";

export function serializeProps(props: Record<string, unknown>): Record<string, unknown> {
  const serializable: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    if (key === "children") continue;

    try {
      JSON.stringify(value);
      serializable[key] = value;
    } catch {
      logger.warn(`[RSC] Skipping non-serializable prop: ${key}`);
    }
  }

  return serializable;
}
