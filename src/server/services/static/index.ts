/**
 * Static File Services
 *
 * Business logic for static file serving.
 *
 * @module server/services/static
 */

export {
  DEFAULT_STATIC_ASSET_MAX_BYTES,
  StaticAssetUnavailableError,
  StaticFileService,
} from "./static-file.service.ts";
export type {
  StaticAssetUnavailableReason,
  StaticFileMetadataResult,
  StaticFileOptions,
  StaticFileResult,
  StaticFileServiceOptions,
} from "./static-file.service.ts";
