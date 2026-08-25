/** A scalar value retained from authenticated provider claims. */
export type AuthClaimPrimitive = string | number | boolean | null;

/** A JSON-safe value retained from authenticated provider claims. */
export type AuthClaimValue =
  | AuthClaimPrimitive
  | readonly AuthClaimValue[]
  | { readonly [key: string]: AuthClaimValue };

/** An immutable snapshot of authenticated provider claims. */
export type SerializedAuthClaims = Readonly<{ readonly [key: string]: AuthClaimValue }>;

/** Authenticated application user context exposed during a request. */
export interface ApplicationIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly email?: string;
  readonly name?: string;
  readonly groups: readonly string[];
  readonly roles: readonly string[];
  readonly groupsComplete: boolean;
  readonly claims: SerializedAuthClaims;
}

/** Serializable authenticated application user context. */
export interface SerializedApplicationIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly email?: string;
  readonly name?: string;
  readonly groups: readonly string[];
  readonly roles: readonly string[];
  readonly groupsComplete: boolean;
  readonly claims: SerializedAuthClaims;
}
