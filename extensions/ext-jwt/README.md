# @veryfront/ext-jwt

Veryfront extension that registers the `AuthProvider` contract, backed by [`jose`](https://github.com/panva/jose). Provides HMAC-based JWT sign / verify (HS256 by default), remote-JWKS verification, and protected-header decoding.

## Installation

Add the extension to your project's `veryfront.config.ts`:

```ts
import extJwt from "@veryfront/ext-jwt";

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
  jwksResolverFactory: (url) => /* custom JWKS resolver — test seam */,
});
```

Both fields are optional. `jwksResolverFactory` is primarily a test seam — production callers should leave it unset so `createRemoteJWKSet` resolves the real JWKS URL.

## Provided contract

`AuthProvider` — supports:

- `sign(payload, options)` — HS256 JWT signing using the configured / env secret.
- `verify(token, options)` — symmetric verification using the same secret.
- `verifyWithJwks(token, jwksUrl, options)` — remote-JWKS verification, with the JWKS document cached per URL by `createRemoteJWKSet`.
- `decodeHeader(token)` — read `kid`, `alg`, etc. without verifying the signature.

## Capabilities

- **net `*`:** `createRemoteJWKSet` fetches JWKS documents from arbitrary issuers at verify time.
