/**
 * Platform-owned origins the renderer itself emits references to.
 *
 * These are not third-party allowances. The renderer writes these URLs into
 * every document it serves -- React from the ESM CDN, optimized images from
 * the platform image service -- so a policy that omits them forbids the same
 * response's own assets. Keeping them in one list means the policy and the
 * emitters cannot drift apart silently.
 *
 * Project-owned external origins (analytics, Google Fonts, a customer CDN) are
 * deliberately absent: those belong to the project, which declares them through
 * `security.csp`. Widening the default for them would grant every hosted site
 * an origin it never asked for.
 *
 * @module security/http/platform-asset-origins
 */

import { ESM_CDN_BASE } from "#veryfront/utils/constants/cdn.ts";

/** Origin serving the platform's optimized image variants. */
export const PLATFORM_IMAGE_ORIGIN = "https://images.veryfront.com";

/** Origin serving platform-hosted static assets that image URLs wrap. */
export const PLATFORM_CDN_ORIGIN = "https://cdn.veryfront.com";

/** Script origins the renderer emits tags for. */
export const PLATFORM_SCRIPT_ORIGINS = [ESM_CDN_BASE] as const;

/** Image origins the renderer emits URLs for. */
export const PLATFORM_IMAGE_ORIGINS = [
  PLATFORM_IMAGE_ORIGIN,
  PLATFORM_CDN_ORIGIN,
] as const;

/** Every platform-owned origin permitted by the default policy. */
export const PLATFORM_ASSET_ORIGINS = [
  ...PLATFORM_SCRIPT_ORIGINS,
  ...PLATFORM_IMAGE_ORIGINS,
] as const;
