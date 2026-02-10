/**
 * Adapters - Security
 *
 * @module platform/adapters/security
 */

export { runInWorker, type SandboxOptions } from "#veryfront/security/sandbox/deno-sandbox.ts";
export {
  type Permission,
  type PermissionRequest,
  type PermissionResult,
  requestPermission,
} from "#veryfront/security/sandbox/permission-system.ts";
