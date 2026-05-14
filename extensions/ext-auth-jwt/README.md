# @veryfront/ext-auth-jwt

> **Category:** Auth | **Contract:** `AuthProvider` | **Optional**

Provides JWT authentication for Veryfront applications: HMAC-based sign/verify (HS256 by default), remote JWKS verification, PEM public-key verification, and protected-header decoding, backed by [`jose`](https://github.com/panva/jose).

## Installation

Add the extension to your project's `veryfront.config.ts`:

```ts
import extJwt from "@veryfront/ext-auth-jwt";

export default defineConfig({
  extensions: [extJwt()],
});
```

## Environment Variables

| Variable     | Required                | Description                                                                      |
| ------------ | ----------------------- | -------------------------------------------------------------------------------- |
| `JWT_SECRET` | Yes (for sign / verify) | HMAC secret for symmetric JWT operations. Without it, `sign` and `verify` throw. |

## Factory configuration

```ts
extJwt({
  secret: "...",                  // overrides JWT_SECRET when set
  jwksResolverFactory: (url) => /* custom JWKS resolver for tests */,
});
```

Both fields are optional. `jwksResolverFactory` is primarily a test seam. Production callers should leave it unset so `createRemoteJWKSet` resolves the real JWKS URL.

## Provided contract

`AuthProvider` supports:

- `sign(payload, options)`: HS256 JWT signing using the configured or env secret.
- `verify(token, options)`: symmetric verification using the same secret.
- `verifyWithJwks(token, jwksUrl, options)`: remote JWKS verification, with the JWKS document cached per URL by `createRemoteJWKSet`.
- `verifyWithPublicKey(token, publicKeyPem, options)`: PEM public-key verification for configured issuer keys.
- `decode(token)`: read `kid`, `alg`, etc. without verifying the signature.

## Capabilities

- **net `*`:** `createRemoteJWKSet` fetches JWKS documents from arbitrary issuers at verify time.
