/**
 * Public environment facade for the `veryfront/platform/env` subpath.
 *
 * Exposes only project-scoped readers. Privileged or mutating accessors
 * (`getHostEnv`, `env`, `setEnv`, `deleteEnv`) stay internal so a tenant
 * project cannot read or alter the host process environment through a
 * supported package export.
 *
 * @module platform/env
 */

/** Options accepted by the boolean environment reader. */
export type { EnvBooleanOptions } from "./compat/process/env.ts";

/** Read an environment variable from the active project scope. */
export { getEnv } from "./compat/process/env.ts";

/** Read a boolean environment variable from the active project scope. */
export { getEnvBoolean } from "./compat/process/env.ts";

/** Read an integer environment variable from the active project scope. */
export { getEnvNumber } from "./compat/process/env.ts";

/** Read a string environment variable with an optional fallback. */
export { getEnvString } from "./compat/process/env.ts";
