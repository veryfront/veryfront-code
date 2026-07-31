/**
 * Maximum uncompressed size of one static build output served by the runtime.
 *
 * The ceiling matches the default bounded Veryfront API success-body budget,
 * exceeds the Cloudflare KV provider's fixed 25 MiB value ceiling, and remains
 * above the build pipeline's narrower generated CSS, client, and release-asset
 * limits. Production builds validate their final output tree against this same
 * value before publication.
 */
export const STATIC_ASSET_MAX_BYTES = 64 * 1024 * 1024;
