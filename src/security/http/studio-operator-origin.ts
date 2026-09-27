import { getHostEnvExcludingEnvFile } from "#veryfront/platform/compat/process.ts";
import { parseConfiguredPlatformRoots } from "#veryfront/server/utils/domain-parser.ts";
import { parseOperatorStudioOrigin } from "./studio-origin-policy.ts";

// Ignore values copied from the project `.env`; this setting belongs to the operator.
const OPERATOR_STUDIO_ORIGIN = parseOperatorStudioOrigin(
  getHostEnvExcludingEnvFile("PLATFORM_STUDIO_ORIGIN"),
  parseConfiguredPlatformRoots(getHostEnvExcludingEnvFile("PLATFORM_DOMAIN_SUFFIXES")),
);

/** The operator's exact Studio origin, outside project-scoped environment views. */
export function getOperatorStudioOrigin(): string | null {
  return OPERATOR_STUDIO_ORIGIN;
}
