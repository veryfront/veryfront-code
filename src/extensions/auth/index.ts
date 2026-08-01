/**
 * Auth contracts, including the required generation-owned, fail-closed React
 * Server Action authorization provider.
 *
 * @module extensions/auth
 */

export type {
  AuthProvider,
  SignOptions,
  TokenHeader,
  TokenPayload,
  VerifyOptions,
} from "./auth-provider.ts";

export type {
  RscActionAuthorizationArray,
  RscActionAuthorizationContext,
  RscActionAuthorizationHeaders,
  RscActionAuthorizationProvider,
  RscActionAuthorizationRecord,
  RscActionAuthorizationRequest,
  RscActionAuthorizationValue,
  RscActionAuthorize,
} from "./rsc-action-authorization-provider.ts";
export {
  createRscActionAuthorizationProvider,
  RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_ARRAY_LENGTH,
  RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_DEPTH,
  RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_NODES,
  RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_PROPERTIES,
  RSC_ACTION_AUTHORIZATION_TERMINATION_GRACE_MS,
  RSC_ACTION_AUTHORIZATION_TIMEOUT_MS,
  RscActionAuthorizationProviderName,
  snapshotRscActionAuthorizationProvider,
} from "./rsc-action-authorization-provider.ts";
