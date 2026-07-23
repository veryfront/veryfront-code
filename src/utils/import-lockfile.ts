export type { LockfileData, LockfileEntry } from "./import-lockfile/types.ts";
export { createEmptyLockfile } from "./import-lockfile/validation.ts";
export { computeIntegrity, verifyIntegrity } from "./import-lockfile/integrity.ts";
export type { FSAdapter, LockfileManager } from "./import-lockfile/types.ts";
export { createLockfileManager } from "./import-lockfile/manager.ts";
export type { FetchWithLockOptions, FetchWithLockResult } from "./import-lockfile/types.ts";
export { fetchWithLock } from "./import-lockfile/fetch.ts";
export type { ParsedImport } from "./import-lockfile/types.ts";
export { extractImports, resolveImportUrl } from "./import-lockfile/scanner.ts";
