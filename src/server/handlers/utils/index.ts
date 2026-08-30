/**
 * Handlers - Utils
 *
 * @module server/handlers/utils
 */

export {
  CONTENT_TYPES,
  getContentType,
  getContentTypeForPath,
  isCacheable,
  isCompressible,
} from "./content-types.ts";
export {
  computeEtag,
  computeStrongEtag,
  hasMatchingEtag,
  matchesAnyEtag,
  parseIfNoneMatch,
} from "./etag.ts";
export {
  createHandlerDependencyPinningSource,
  getHandlerDependencyPinningIdentity,
  type HandlerDependencyPinningIdentity,
} from "./dependency-pinning-source.ts";
export {
  applySnapshotResponseHeaders,
  DEPENDENCY_PINS_HEADER,
  DEPENDENCY_PINS_QUERY_PARAM,
  readSnapshotHeader,
  readSnapshotQuery,
  resolveSnapshotForRequest,
  SNAPSHOT_CONFLICT_BODY,
  snapshotConflictResponse,
  type SnapshotRequest,
  type SnapshotResolution,
  type SnapshotResolutionOptions,
  stripSnapshotHeader,
  stripSnapshotQuery,
  withSnapshotResponseHeaders,
} from "./dependency-snapshot-protocol.ts";
export {
  buildProjectExecutionUnavailableResponse,
  type ProjectExecutionUnavailableOptions,
} from "./project-execution-unavailable.ts";
