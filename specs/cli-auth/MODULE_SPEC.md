# cli/auth Module -- Behavioral NLSpec

## Purpose

Provides CLI authentication: OAuth browser login (Google, GitHub, Microsoft),
manual API-token entry, secure token persistence, and session lifecycle
(login / logout / whoami / ensureAuthenticated).

---

## Public API (re-exported from `index.ts`)

### Types

| Export       | Kind      | Description                                       |
| ------------ | --------- | ------------------------------------------------- |
| `AuthMethod` | type      | `"google" \| "github" \| "microsoft" \| "token"` |
| `UserInfo`   | interface | `{ id: string; email: string; name?: string }`   |
| `CallbackServer` | interface | OAuth callback HTTP server handle            |

### Functions

| Export                | Source             | Signature (simplified)                                                   |
| --------------------- | ------------------ | ------------------------------------------------------------------------ |
| `login`               | `login.ts`         | `(method?: AuthMethod) => Promise<UserInfo \| null>`                     |
| `logout`              | `login.ts`         | `() => Promise<void>`                                                    |
| `whoami`              | `login.ts`         | `(env?: EnvironmentConfig) => Promise<UserInfo \| null>`                 |
| `ensureAuthenticated` | `login.ts`         | `(env?: EnvironmentConfig) => Promise<UserInfo \| null>`                 |
| `validateToken`       | `login.ts`         | `(token: string) => Promise<UserInfo \| null>`                           |
| `readToken`           | `login.ts` (re)    | `(env?: EnvironmentConfig) => Promise<string \| null>`                   |
| `saveToken`           | `login.ts` (re)    | `(token: string, env?: EnvironmentConfig) => Promise<void>`             |
| `deleteToken`         | `login.ts` (re)    | `(env?: EnvironmentConfig) => Promise<void>`                             |
| `hasToken`            | `login.ts` (re)    | `(env?: EnvironmentConfig) => Promise<boolean>`                          |
| `startCallbackServer` | `callback-server.ts` | `(preferredPort?: number) => Promise<CallbackServer>`                  |
| `getCallbackUrl`      | `callback-server.ts` | `(port: number) => string`                                            |
| `getTokenLocation`    | `token-store.ts`   | `(env?: EnvironmentConfig) => string`                                    |
| `canOpenBrowser`      | `browser.ts`       | `(env?: EnvironmentConfig) => boolean`                                   |
| `openBrowser`         | `browser.ts`       | `(url: string) => Promise<void>`                                         |

### Internal-only (not in `index.ts`)

| Function           | File       | Description                                     |
| ------------------ | ---------- | ----------------------------------------------- |
| `parseLoginMethod` | `utils.ts` | Extracts `AuthMethod` from `ParsedArgs` flags   |

---

## Behavioral Contracts

### `validateToken(token)`

- Calls `GET {apiUrl}/me` with `Authorization: Bearer {token}`.
- Returns parsed `UserInfo` on HTTP 200 with valid JSON body.
- Returns `null` on any non-OK status (body is cancelled to avoid leaks).
- Returns `null` on network/parse errors (caught silently).

### `login(method?)`

- If `method` is omitted and stdin is a TTY, presents an interactive
  arrow-key selector over `AUTH_OPTIONS` (Google, GitHub, Microsoft, Token).
- If stdin is not a TTY, defaults to `"token"`.
- OAuth methods (`google | github | microsoft`):
  1. Guards `canOpenBrowser()`; returns `null` if unavailable.
  2. Starts a local `CallbackServer` on an available port.
  3. Constructs the API OAuth URL with a `redirect_uri` pointing to the
     callback server.
  4. Opens the browser; prints the URL as fallback.
  5. Waits up to `DEFAULT_LOGIN_TIMEOUT_MS` (120 s) for the callback.
  6. On success, validates the received token and persists it.
- Token method:
  1. Prompts for a token string via `promptUser`.
  2. Validates and persists on success.
- Returns `UserInfo` on success, `null` on any failure path.

### `ensureAuthenticated(env?)`

Priority order:
1. `env.apiToken` (environment variable) -- validate, return if valid.
2. Stored token on disk -- validate, return if valid; delete if expired.
3. If TTY, trigger interactive `login()`.
4. If non-TTY, log error and return `null`.

### `logout()`

- Deletes the stored token file.

### `whoami(env?)`

- Checks `env.apiToken` first, then stored token.
- Prints identity and token source on success.
- Prints "Not logged in" if neither source yields a valid token.

### Token Store (`token-store.ts`)

- Path: `$XDG_CONFIG_HOME/veryfront/token` (falls back to
  `$HOME/.config/veryfront/token`).
- `saveToken` creates the config directory recursively, writes the token
  with a trailing newline, and sets file permissions to `0o600`.
- `readToken` trims whitespace; returns `null` for empty or missing files.
- `deleteToken` is a no-op if the file does not exist.
- `hasToken` delegates to `readToken`.

### Callback Server (`callback-server.ts`)

- Starts an HTTP server on `127.0.0.1` at the preferred port (default 9876).
- On `AddrInUse`, retries up to `MAX_PORT_ATTEMPTS` (100) consecutive ports.
- Routes only `GET /callback`; all other paths return 404.
- Extracts `?token=` or `?error=` from the callback URL.
- Renders an HTML success or error page (XSS-safe via `escapeHtml`).
- `waitForCallback(timeoutMs)` races the callback promise against a timeout.
- Uses `Deno.serve` when running on Deno, `node:http` otherwise.

### Browser (`browser.ts`)

- `openBrowser` shells out to `open` (macOS), `cmd /c start` (Windows),
  or `xdg-open` (Linux).
- `canOpenBrowser` returns `false` in CI, SSH sessions, or headless Linux
  (no `$DISPLAY` / `$WAYLAND_DISPLAY`).

### `parseLoginMethod(args)` (`utils.ts`)

- Reads boolean flags `google`, `github`, `microsoft`, `token` from
  `ParsedArgs`, returning the first truthy one in that priority order.
- Returns `undefined` when none are set.

---

## External Consumers

| File                           | Imports used                                          |
| ------------------------------ | ----------------------------------------------------- |
| `cli/router.ts`                | `login`, `logout`, `whoami`, `parseLoginMethod`       |
| `cli/router.test.ts`           | `parseLoginMethod`                                    |
| `cli/shared/config.ts`         | `readToken`, `ensureAuthenticated`                    |
| `cli/sync/project-discovery.ts`| `readToken`, `UserInfo`, `validateToken`              |
| `cli/app/shell.ts`             | `logout`, `validateToken`, `readToken`, `openBrowser` |
| `cli/app/actions.ts`           | `openBrowser`                                         |
| `cli/app/utils.ts`             | `readToken`                                           |

Note: Several consumers bypass `index.ts` and import directly from
`login.ts`, `token-store.ts`, and `browser.ts`. The public barrel
(`index.ts`) re-exports a subset that covers the majority of use cases.
