# Authelia OIDC setup

Use Authelia as the OIDC Provider and Veryfront as a confidential OIDC client.

## Client registration

Register the exact redirect URI:

```text
https://<APP_HOST>/_veryfront/auth/callback
```

Use authorization code flow with:

- `public: false`
- `response_types: [code]`
- `token_endpoint_auth_method: client_secret_basic`
- `require_pkce: true`
- `pkce_challenge_method: S256`

Start with the `openid` scope. Add `profile`, `email`, and `groups` only when your application uses those claims.

Authelia stores a supported hash of the client secret. Veryfront receives the plaintext secret through `OIDC_CLIENT_SECRET`.

Authelia must already have a reviewed OIDC provider configuration, including `hmac_secret`, `jwks`, and at least one suitable RS256 RSA key. This scaffold does not generate provider secrets or private keys.

Veryfront validates state, nonce, signature, exact issuer, audience/client ID, and redirect URI. Use `(iss, sub)` as the stable external identity key.

Cloud and self-hosted Veryfront apps use the same declarative OIDC config. Horizontally scaled instances must share `APP_URL`, OIDC settings, and `VERYFRONT_AUTH_SESSION_SECRET`. No sticky sessions, database session store, or distributed cache is required for admission.

Official docs:

- https://www.authelia.com/configuration/identity-providers/openid-connect/provider/
- https://www.authelia.com/configuration/identity-providers/openid-connect/clients/
