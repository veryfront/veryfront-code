# Veryfront OIDC auth setup

This scaffold configures Veryfront's built-in OIDC runtime. It does not add an auth adapter, callback route, token handler, middleware, or provider-specific runtime code.

## Generated files

- `veryfront.auth.config.example.ts`: example `security.auth.oidc` block to merge into your Veryfront config.
- `.env.auth.example`: environment variable names and placeholders.
- `AUTH_PROVIDER_SETUP.md`: provider-specific setup notes.

## Merge the config

Copy the `security.auth.oidc` object from `veryfront.auth.config.example.ts` into your existing `veryfront.config.ts`, `veryfront.config.js`, `veryfront.config.mjs`, `veryfront.json`, or other supported config source.

For an ordinary declarative config, merge it like this:

```ts
import { defineConfig } from "veryfront";

export default defineConfig({
  security: {
    auth: {
      oidc: {
        issuerEnvVar: "OIDC_ISSUER",
        clientIdEnvVar: "OIDC_CLIENT_ID",
        clientSecretEnvVar: "OIDC_CLIENT_SECRET",
        sessionSecretEnvVar: "VERYFRONT_AUTH_SESSION_SECRET",
        scopes: ["openid", "profile", "email", "groups"],
        claims: {
          email: "email",
          name: "name",
          groups: "groups",
          roles: "roles",
        },
      },
    },
  },
});
```

If your config uses imports, `defineConfigWithEnv`, or a function, return the same declarative data shape from that function. Do not execute provider code from config.

## Register the redirect URI

Register this exact redirect URI for each deployed environment:

```text
https://<APP_HOST>/_veryfront/auth/callback
```

Do not use wildcard redirect URIs or path patterns.

Veryfront owns these routes:

- `/_veryfront/auth/login`
- `/_veryfront/auth/callback`
- `/_veryfront/auth/logout`

## Runtime behavior

Use authorization code flow with `response_type=code`, PKCE S256, and the `openid` scope. Add `profile`, `email`, and `groups` only when your app uses those claims.

Veryfront validates state, nonce, ID token signature, exact issuer, audience/client ID, and redirect URI. Do not duplicate that logic in application routes.

Use `(iss, sub)` as the stable external identity key. Do not use email, display name, username, or group labels as account keys.

Use one exact issuer per app. Dynamic issuer templates are not part of this scaffold.

Cloud and self-hosted deployments use the same declarative OIDC configuration. Horizontally scaled instances must share the same `APP_URL`, issuer, client ID, client secret, and `VERYFRONT_AUTH_SESSION_SECRET`. No sticky sessions, database session store, or distributed cache is required for admission because transactions and sessions are authenticated self-contained cookies.

Coordinated session-secret rotation invalidates old sessions. A mismatched instance fails closed.

## Environment

Copy `.env.auth.example` into the environment manager for each deployment and replace placeholders there. Do not commit real credentials.

Set `APP_URL` to the exact public origin for the app, for example `https://<APP_HOST>`.
