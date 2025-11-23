export * from "./base.ts";
export * from "./bun.ts";
export * from "./deno.ts";
export * from "./detect.ts";
export * from "./mock.ts";
export * as security from "./security/index.ts";

export type { DirectoryEntry, FSAdapter, FSAdapterConfig } from "./veryfront-fs-adapter/types.ts";

export {
  type ListFilesResponse,
  type ListProjectsResponse,
  type Project,
  type ProjectFile,
  VeryfrontAPIClient,
  type VeryfrontAPIConfig,
  VeryfrontAPIError,
} from "./veryfront-api-client.ts";

export { VeryfrontFSAdapter } from "./veryfront-fs-adapter.ts";

export { FSAdapterWrapper, NotSupportedError, wrapFSAdapter } from "./fs-adapter-wrapper.ts";

export {
  createFSAdapterFromConfig,
  enhanceAdapterWithFS,
  getFSAdapterType,
  isFSAdapterConfigured,
} from "./fs-integration.ts";

export { createFSAdapter } from "./fs-adapter-factory.ts";

export {
  type AsyncAdapterFallback,
  createAdapterFallback,
  createAdapterFallbackSync,
  FallbackExecutionError,
  type FallbackOptions,
  type SyncAdapterFallback,
  withFallback,
  withFallbackSync,
} from "./fallback-wrapper.ts";
