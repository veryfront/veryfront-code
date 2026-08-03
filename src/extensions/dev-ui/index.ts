/** Contracts and protocol constants for extension-owned local development UIs. */

export {
  createDevUiAssetProvider,
  type DevUiAssetProvider,
  DevUiAssetProviderName,
  MAX_DEV_UI_BUNDLE_BYTES,
  snapshotDevUiAssetProvider,
  validateDevUiBundle,
} from "./dev-ui-asset-provider.ts";
export {
  DASHBOARD_CSRF_COOKIE_NAME,
  DASHBOARD_CSRF_HEADER_NAME,
  DASHBOARD_CSRF_META_NAME,
  DASHBOARD_CSRF_TOKEN_PATTERN,
  DASHBOARD_SESSION_PATH,
  DEV_UI_KIND_ATTRIBUTE,
  type DevUiKind,
  getDashboardSessionCookieName,
} from "./protocol.ts";
