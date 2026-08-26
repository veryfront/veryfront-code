/**
 * Project-scoped environment access safe for public runtime consumers.
 *
 * Read-only on purpose: the process-wide mutators (`setEnv`, `deleteEnv`)
 * stay internal so tenant code cannot overwrite or delete host environment
 * variables. Framework code reaches them through internal compat imports.
 */
export { env, getEnv, getEnvBoolean, getEnvNumber, getEnvString } from "./env.ts";
export type { EnvBooleanOptions } from "./env.ts";
