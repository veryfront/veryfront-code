# NLSpec: src/oauth/

## Purpose

Provides a complete OAuth 2.0 authorization code flow implementation with 37 pre-configured provider configs (Google, Microsoft, Atlassian, and 26 common SaaS services). The module handles authorization URL generation (with PKCE support), token exchange, token refresh, token revocation, and offers factory functions to create HTTP handler closures for init, callback, status, and disconnect routes. A pluggable `TokenStore` interface (with a default in-memory implementation) manages OAuth state and token persistence.

## Public API

### Exports (from `src/oauth/index.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `OAuthProvider` | class | Low-level OAuth provider: builds auth URLs, exchanges codes, refreshes/revokes tokens |
| `OAuthService` | class (extends `OAuthProvider`) | Higher-level service with default scopes, token store integration, and authenticated `fetch` |
| `MemoryTokenStore` | class | In-memory `TokenStore` implementation with 10-minute state expiration |
| `createOAuthInitHandler` | function | Factory returning a handler that redirects the user to the provider's authorization URL |
| `createOAuthCallbackHandler` | function | Factory returning a handler that processes the OAuth callback (state validation, code exchange, token storage) |
| `createOAuthStatusHandler` | function | Factory returning a handler that reports connection status for a service |
| `createOAuthDisconnectHandler` | function | Factory returning a handler that clears stored tokens for a service |
| `OAuthInitHandlerOptions` | type | Options for `createOAuthInitHandler` |
| `OAuthCallbackHandlerOptions` | type | Options for `createOAuthCallbackHandler` |
| `AuthorizationUrlOptions` | type | Options for building authorization URLs (scopes, state, PKCE, extra params) |
| `OAuthProviderConfig` | type | Static provider configuration (URLs, env var names, auth params) |
| `OAuthServiceConfig` | type | Extends `OAuthProviderConfig` with `serviceId`, `defaultScopes`, `apiBaseUrl` |
| `OAuthState` | type | CSRF/PKCE state stored between init and callback |
| `OAuthTokens` | type | Token set (access, refresh, expiry, type, scope, id_token) |
| `TokenExchangeOptions` | type | Input for code-for-token exchange (code, redirectUri, codeVerifier) |
| `TokenExchangeResult` | type | Result of token exchange (success flag, tokens or error) |
| `TokenStore` | interface | Contract for token/state persistence |
| `gmailConfig`, `calendarConfig`, `sheetsConfig`, `driveConfig` | const | Google service configs |
| `outlookConfig`, `teamsConfig`, `sharePointConfig`, `oneDriveConfig` | const | Microsoft service configs |
| `jiraConfig`, `confluenceConfig`, `bitbucketConfig` | const | Atlassian service configs |
| 26 common configs (`githubConfig`, `slackConfig`, etc.) | const | Individual SaaS service configs |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `z` (Zod) | `zod` | Schema definitions and type inference for all OAuth data structures |
| `logger` | `#veryfront/utils` | Structured logging in handlers |
| `getEnv` | `#veryfront/platform/compat/process.ts` | Read environment variables (client ID/secret) |
| `getEnvironmentConfig` / `EnvironmentConfig` | `#veryfront/config/environment-config.ts` | Resolve `appUrl` for redirect URIs |
| `crypto` (Web Crypto API) | runtime global | PKCE code verifier/challenge generation |

## Behaviors

### Behavior 1: Authorization URL generation
- **Given**: An `OAuthProvider` or `OAuthService` with a configured client ID
- **When**: `createAuthorizationUrl()` is called
- **Then**: Returns a URL with `client_id`, `redirect_uri`, `response_type=code`, `state`, `scope`, PKCE `code_challenge` (S256), and any additional provider params; also returns an `OAuthState` object containing the `codeVerifier`
- **Edge cases**: PKCE is enabled by default (`usePkce !== false`); when disabled, no code_challenge is added. If `clientIdEnvVar` is not set, throws an error.

### Behavior 2: Init handler redirects to provider
- **Given**: A handler created by `createOAuthInitHandler(config)`
- **When**: The handler is invoked
- **Then**: It checks the provider is configured, builds an authorization URL, stores the state in the token store, and returns a `302 redirect` to the provider
- **Edge cases**: Returns JSON 500 if client ID/secret env vars are missing; returns JSON 500 if URL generation throws

### Behavior 3: Callback handler exchanges code for tokens
- **Given**: A handler created by `createOAuthCallbackHandler(config)` and a valid OAuth state in the store
- **When**: The handler receives a request with `code` and `state` query params
- **Then**: It validates the state against the store, exchanges the code for tokens via POST to the token URL, stores the tokens, clears the state, calls `onSuccess` if provided, and redirects to `successRedirect` with `?connected=<serviceId>`
- **Edge cases**: If `error` param is present, redirects with error. If `code` is missing, redirects with `no_code`. If `state` is missing or invalid/expired, redirects with `invalid_state`. If `skipStateValidation` is true, missing state is allowed. Network errors during token exchange produce `network_error`.

### Behavior 4: State validation (CSRF protection)
- **Given**: A state string stored via `tokenStore.setState()`
- **When**: The callback handler looks it up via `tokenStore.getState(state)`
- **Then**: Returns the state if it exists and was created within 10 minutes; returns `null` if missing or expired
- **Edge cases**: `MemoryTokenStore.setState()` triggers cleanup of all expired states

### Behavior 5: Token refresh
- **Given**: An `OAuthService` with a token store containing tokens with a `refreshToken`
- **When**: `getAccessToken()` is called and the token is within 5 minutes of expiry (or expired)
- **Then**: Automatically refreshes using `refresh_token` grant type, stores new tokens, returns the new access token
- **Edge cases**: If no refresh token, returns `null`. If refresh fails, returns `null`.

### Behavior 6: Authenticated API fetch
- **Given**: An `OAuthService` with valid tokens
- **When**: `fetch(endpoint, options)` is called
- **Then**: Gets a valid access token (refreshing if needed), makes the request with `Authorization: Bearer` header, returns parsed JSON
- **Edge cases**: Throws if not authenticated. Throws on non-OK responses with status and body text.

### Behavior 7: Token revocation
- **Given**: An `OAuthProvider` with a `revocationUrl` configured
- **When**: `revokeToken(token)` is called
- **Then**: POSTs to the revocation URL and returns `true` on success
- **Edge cases**: Returns `false` if no revocation URL configured or if the request fails

### Behavior 8: Status handler
- **Given**: A handler created by `createOAuthStatusHandler(config)`
- **When**: The handler is invoked
- **Then**: Returns JSON with `service`, `displayName`, `connected` (boolean), `configured` (boolean), `expiresAt`, `hasRefreshToken`
- **Edge cases**: `connected` is true only if tokens exist AND either not expired or has refresh token

### Behavior 9: Disconnect handler
- **Given**: A handler created by `createOAuthDisconnectHandler(config)`
- **When**: The handler is invoked
- **Then**: Clears stored tokens and returns JSON `{ success: true, message }`

## Constraints
- Do NOT change public API signatures
- Do NOT modify files outside `src/oauth/`
- Must pass: `deno fmt --check src/oauth/`, `deno lint src/oauth/`, `deno test --no-check --allow-all src/oauth/`

## Error Handling
- `createAuthorizationUrl` throws if client ID env var is not set
- `exchangeCode` / `refreshTokens` return `{ success: false, error, errorDescription }` on failure (never throw)
- `revokeToken` returns `false` on failure (never throws)
- Handler factories catch errors and redirect with error query params (init handler returns JSON 500)
- Network errors during token exchange are caught and returned as `{ error: "network_error" }`

## Side Effects
- `MemoryTokenStore` is a module-level singleton (`memoryTokenStore`) shared across all handlers that use the default
- `setState` triggers cleanup of expired states from the in-memory map
- Handlers call `fetch()` to external OAuth provider endpoints
- `onSuccess` / `onError` callbacks in handler options are called as side effects

## Performance Constraints
- State expiration is 10 minutes (hardcoded in `MemoryTokenStore`)
- Token refresh triggers proactively at 5 minutes before expiry (300,000ms buffer in `getAccessToken`)
- Expired state cleanup runs on every `setState` call (iterates all stored states)

## Invariants
- State is always cleared after successful token exchange
- PKCE is always used unless explicitly disabled (`usePkce: false`)
- All token exchange results conform to `TokenExchangeResult` schema (success + tokens, or success=false + error)
- Provider configs are immutable `const` objects
- `useBasicAuth` providers send credentials in the `Authorization: Basic` header instead of the request body
