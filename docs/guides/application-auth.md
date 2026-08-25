---
title: "Application authentication"
description: "Protect application routes with provider-neutral login on Veryfront Cloud and self-hosted runtimes."
order: 53
---

Use `security.auth` when the application itself needs a login boundary before
project middleware or routes run. The default integration point is declarative
configuration, not an extension or a template-only pattern. A template or
scaffold can write the config and environment placeholders, but the runtime
behavior belongs to Veryfront.

This keeps Authelia, Microsoft Entra ID, AD FS, and other providers on the same
surface: Veryfront speaks OpenID Connect to the provider, verifies the ID token,
creates an encrypted application session, and exposes one normalized identity to
middleware and routes.

## Choose a mode

Use OIDC for user login in Veryfront Cloud and self-hosted deployments. Use
trusted-proxy auth only when a self-hosted reverse proxy authenticates the user
and asserts identity over a transport path the operator controls.

| Need                                                                           | Use                                                                                   |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Authelia, Entra ID, AD FS, Keycloak, Authentik, Okta, or another OIDC provider | `security.auth.oidc`                                                                  |
| Active Directory users                                                         | OIDC through Entra ID, AD FS 2019+, or another directory-backed identity provider     |
| Existing app with its own routes                                               | `veryfront generate auth <provider>` or the MCP scaffold, then review the config diff |
| Self-hosted proxy that already authenticates users                             | `security.auth.trustedProxy`                                                          |
| Per-route authorization rules                                                  | Middleware or route code that reads the normalized identity                           |

Veryfront does not bind directly to LDAP, NTLM, or Kerberos in application code.
Put Active Directory behind Entra ID, AD FS, or another OIDC provider, then
connect Veryfront to that provider.

## Configure OIDC

Add the OIDC mode in `veryfront.config.ts` and keep secrets in environment
variables:

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
      },
    },
  },
});
```

Set the environment values in Cloud, CI, or your self-hosted runtime:

```bash
APP_URL="https://<APP_HOST>"
OIDC_ISSUER="https://idp.example.com"
OIDC_CLIENT_ID="<OIDC_CLIENT_ID>"
OIDC_CLIENT_SECRET="<OIDC_CLIENT_SECRET>"
VERYFRONT_AUTH_SESSION_SECRET="<32_BYTE_OR_LONGER_RANDOM_SECRET>"
```

Set `APP_URL` to the exact public HTTPS origin for the deployment. Local direct
loopback development can derive the origin from the request. Cloud, production,
and proxied deployments require `APP_URL`.

Generate the session secret with your deployment secret manager or an equivalent
cryptographic random source. All horizontally scaled instances for one
environment must receive the same value. Rotate it as a coordinated deployment;
old sessions stop working after rotation.

## Provider setup

Register this redirect URI with the provider:

```text
https://<APP_ORIGIN>/_veryfront/auth/callback
```

Veryfront uses authorization code flow with PKCE and validates issuer, audience,
authorized party, nonce, state, token signature, token age, and key type. Use a
confidential client secret for server-side deployments. Providers such as
Authelia commonly support `client_secret_basic`; configure that provider-side
method when the provider asks how the client authenticates.

For Authelia, use the Authelia issuer URL and a confidential OIDC client. For
Microsoft Entra ID, use the tenant-specific issuer and register the exact
redirect URI. For AD FS, use an AD FS version that supports OIDC authorization
code flow and PKCE, or front Active Directory with Entra ID.

If the provider publishes authorization, token, or JWKS endpoints on a different
HTTPS origin from the issuer, list the canonical origins explicitly:

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
        scopes: ["openid", "profile", "email"],
        trustedEndpointOrigins: ["https://idp-endpoints.example.com"],
      },
    },
  },
});
```

Self-hosted runtimes block outbound requests to private and loopback addresses
by default. If the identity provider is on an internal network, allow only its
exact origin in the host process:

```bash
VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS="https://auth.internal.example.com"
```

This is an operator-owned host setting, not application configuration. List
comma-separated exact origins when the provider uses more than one internal
origin. Do not use the broad internal-egress override for application auth.

Changing `clientId`, claim mappings, scopes, signing algorithms, issuer,
callback origin, or `trustedEndpointOrigins` invalidates existing sessions.

## Routes and request behavior

Veryfront reserves these routes:

- `GET /_veryfront/auth/login`
- `GET /_veryfront/auth/callback`
- `POST /_veryfront/auth/logout`

HTML navigations redirect to login. API requests receive a no-store `401`.
Logout requires `POST` and a same-origin `Origin` header.

After a request is admitted, middleware and routes receive the same identity.
The stable user key is `(issuer, subject)`. Map that pair to your own user
record before applying application authorization.

Microsoft group overage does not become an empty group list. When a token says
groups must be fetched elsewhere, Veryfront sets `groupsComplete: false`.
Application authorization that depends on groups must treat incomplete groups as
not enough information.

## Existing apps

For an existing project, start with a scaffold instead of hand-editing every
file:

```bash
veryfront generate auth authelia
```

The scaffold writes a config fragment, environment placeholders, and provider
setup notes. It does not rewrite application routes or middleware. If you use a
coding agent through the Veryfront MCP server, ask it to scaffold
`type: "auth"` and then inspect the diff.

Keep authorization in your existing middleware or route layer. The scaffold only
adds the login boundary and identity normalization.

## Veryfront Cloud and self-hosting

OIDC works in Veryfront Cloud and self-hosted apps because login transaction
state and application sessions are encrypted cookies. There is no in-memory
session store. There is no sticky-session requirement, database, or distributed
cache in the request admission path.

Each instance keeps its own bounded OIDC discovery and JWKS caches. These caches
improve performance only. A cold instance can fetch provider metadata and keys
independently, and key rotation converges without sharing process memory.

For Cloud, keep auth config declarative. `veryfront.config.ts` can contain
functions for general configuration, but hosted auth must resolve to a static
`security.auth` shape. Do not put provider clients, network calls, token
verification code, or request-specific auth logic in config.

For self-hosted trusted-proxy auth, configure exact trusted native peer
addresses and strip incoming identity headers at the proxy before setting the
trusted values:

```ts
import { defineConfig } from "veryfront";

export default defineConfig({
  security: {
    auth: {
      trustedProxy: {
        trustedPeers: ["10.0.0.10"],
        headers: {
          subject: "x-auth-subject",
          email: "x-auth-email",
          groups: "x-auth-groups",
        },
      },
    },
  },
});
```

Trusted-proxy auth is not available in Veryfront Cloud. It trusts transport
provenance, not `Forwarded`, `X-Forwarded-For`, or any caller-controlled header.

## Security checklist

- Use HTTPS provider endpoints. Allow insecure loopback only for local
  development.
- Register the exact callback URI with the provider.
- Allow only the provider's exact internal origins in self-hosted runtimes.
- Store `OIDC_CLIENT_SECRET` and `VERYFRONT_AUTH_SESSION_SECRET` as secrets.
- Share one session secret across horizontally scaled instances in the same
  environment.
- Use the minimum scopes your app needs. Keep `openid`.
- Treat `(issuer, subject)` as the external identity key.
- Treat `groupsComplete: false` as not authorized for group-dependent actions.
- Keep app authorization in middleware or routes after the Veryfront login
  boundary.
- Rotate session secrets intentionally and expect existing sessions to be
  cleared.

## Verify it worked

Start the app and open a protected route in a new browser session. HTML routes
should redirect to `/_veryfront/auth/login`, then return to the original path
after provider sign-in.

Probe an API route without cookies:

```bash
curl -i https://<APP_ORIGIN>/api/account
```

Expect `401` and `Cache-Control: no-store`. After sign-in, the same route should
see the normalized identity in middleware or route code.

For horizontal scaling, complete login on one instance and send the session
cookie to another instance with the same `VERYFRONT_AUTH_SESSION_SECRET`. The
second instance should admit the request without sticky routing.

## Related

- [Configuration](./configuration.md): define `security.auth`
- [Middleware](./middleware.md): apply application authorization after login
- [Deploying](./deploying.md): set environment secrets for Cloud deployments
- [Self-host Veryfront Code](./self-hosting.md): run OIDC or trusted-proxy auth
- [Cloud environment access](./cloud-environment-access.md): separate Cloud
  preview access from application login
