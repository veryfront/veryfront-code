import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { parseConfiguredPlatformRoots } from "#veryfront/server/utils/domain-parser.ts";
import { parseOperatorStudioOrigin } from "./studio-origin-policy.ts";

// Capture the host setting before project-scoped environment views can run.
const OPERATOR_STUDIO_ORIGIN = parseOperatorStudioOrigin(
  getHostEnv("PLATFORM_STUDIO_ORIGIN"),
  parseConfiguredPlatformRoots(getHostEnv("PLATFORM_DOMAIN_SUFFIXES")),
);

/** The operator's exact Studio origin, outside project-scoped environment views. */
export function getOperatorStudioOrigin(): string | null {
  return OPERATOR_STUDIO_ORIGIN;
}
