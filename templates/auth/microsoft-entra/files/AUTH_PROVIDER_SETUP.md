# Microsoft Entra ID OIDC setup

Use a tenant-specific v2 issuer:

```text
https://login.microsoftonline.com/<TENANT_ID_OR_DOMAIN>/v2.0
```

Do not use `common`. Multi-tenant and dynamic issuer handling are not part of this first release.

## App registration

Register a Web platform redirect URI exactly:

```text
https://<APP_HOST>/_veryfront/auth/callback
```

Use the Application (client) ID as `OIDC_CLIENT_ID`.

Production confidential clients should prefer a certificate or federated credential where the deployment supports it. The current Veryfront runtime accepts `client_secret_basic`, so this scaffold uses a client secret and requires planned expiry and rotation.

Before deployment, confirm that the tenant's discovery document advertises `client_secret_basic`. If it does not, this Veryfront release is not compatible with that tenant. Do not substitute `client_secret_post` or add an application proxy or callback handler.

Prefer app roles for new authorization design. Entra JWT/OIDC group claims are limited to 200 memberships and may be replaced by an overage indicator. In that case `groupsComplete` can be false, and application code must fail closed or use a separately authorized Microsoft Graph lookup.

Do not use `email`, `name`, or other mutable human-readable claims as account keys or authorization authority. Use `(iss, sub)` as the stable external identity key.

Cloud and self-hosted Veryfront apps use the same declarative OIDC config. Horizontally scaled instances must share `APP_URL`, OIDC settings, and `VERYFRONT_AUTH_SESSION_SECRET`. No sticky sessions, database session store, or distributed cache is required for admission.

Official docs:

- https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials
- https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference
- https://learn.microsoft.com/en-us/entra/identity/hybrid/connect/how-to-connect-fed-group-claims
