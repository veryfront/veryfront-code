export type AuthClaimPrimitive = string | number | boolean | null;

export type AuthClaimValue =
  | AuthClaimPrimitive
  | readonly AuthClaimValue[]
  | { readonly [key: string]: AuthClaimValue };

export type SerializedAuthClaims = Readonly<{ readonly [key: string]: AuthClaimValue }>;

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
