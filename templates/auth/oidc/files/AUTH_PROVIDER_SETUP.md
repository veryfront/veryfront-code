# Generic OIDC setup

Use this preset for standards-compatible OIDC providers, including OIDC-enabled AD FS 2016 or later when its discovery document and confidential-client methods are compatible.

## Client registration

Register the exact redirect URI:

```text
https://<APP_HOST>/_veryfront/auth/callback
```

Use authorization code flow with `response_type=code`, PKCE S256, and the `openid` scope. Add `profile`, `email`, and `groups` only when your application uses those claims.

Set `OIDC_ISSUER` to one exact issuer for the app. For AD FS, the discovery document is commonly under:

```text
https://<ADFS_HOST>/adfs/.well-known/openid-configuration
```

Do not hard-code discovery endpoints into Veryfront config. Set the issuer that matches the provider's discovery document and ID token `iss` value.

Direct LDAP, Active Directory bind credentials, NTLM, Kerberos, and provider-specific callback handlers are outside this scaffold. Active Directory users integrate through a standards-compatible OIDC issuer such as Microsoft Entra ID, OIDC-enabled AD FS, or another IdP connected to the directory.

Veryfront validates state, nonce, signature, exact issuer, audience/client ID, and redirect URI. Use `(iss, sub)` as the stable external identity key. Email, display name, username, and group labels are not stable account identifiers.

Cloud and self-hosted Veryfront apps use the same declarative OIDC config. Horizontally scaled instances must share `APP_URL`, OIDC settings, and `VERYFRONT_AUTH_SESSION_SECRET`. No sticky sessions, database session store, or distributed cache is required for admission.

Official docs:

- https://openid.net/specs/openid-connect-core-1_0.html
- https://www.rfc-editor.org/info/rfc9700/
- https://learn.microsoft.com/en-us/windows-server/identity/ad-fs/development/ad-fs-openid-connect-oauth-concepts
