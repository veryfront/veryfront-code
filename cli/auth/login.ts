import { cliLogger } from "#cli/utils";
import { getStdinReader, setRawMode, writeStdout } from "veryfront/platform";
import { type EnvironmentConfig, getEnvironmentConfig } from "veryfront/config";
import { deleteToken, getTokenLocation, hasToken, readToken, saveToken } from "./token-store.ts";
import { getCallbackUrl, startCallbackServer } from "./callback-server.ts";
import { canOpenBrowser, openBrowser } from "./browser.ts";
import { isTTY, promptUser } from "../utils/index.ts";
import { brand, dim, error, muted, success, warning } from "../ui/colors.ts";
import { DEFAULT_CALLBACK_PORT, DEFAULT_LOGIN_TIMEOUT_MS, getApiUrl } from "../shared/constants.ts";
import { createSuccessEnvelope, isJsonMode, outputJson } from "../shared/json-output.ts";

export type AuthMethod = "google" | "github" | "microsoft" | "token";

export interface UserInfo {
  id: string;
  email: string;
  name?: string;
}

export interface ApiKeyIdentity {
  authenticated: true;
  type: "apiKey";
}

export type AuthIdentity = UserInfo | ApiKeyIdentity;

const AUTH_OPTIONS: { id: AuthMethod; label: string }[] = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
  { id: "microsoft", label: "Microsoft" },
  { id: "token", label: "API Token" },
];

export function createOAuthState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createOAuthAuthorizationUrl(
  provider: "google" | "github" | "microsoft",
  callbackUrl: string,
  state: string,
): string {
  const stateBoundCallbackUrl = new URL(callbackUrl);
  stateBoundCallbackUrl.searchParams.set("state", state);

  const authUrl = new URL(`${getApiUrl().replace(/\/$/, "")}/auth/${provider}`);
  authUrl.searchParams.set("redirect_uri", stateBoundCallbackUrl.toString());
  authUrl.searchParams.set("state", state);
  return authUrl.toString();
}

export async function validateToken(token: string): Promise<UserInfo | null> {
  try {
    const response = await fetch(`${getApiUrl()}/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    if (!response.ok) {
      // Consume response body to prevent resource leak
      await response.body?.cancel();
      return null;
    }

    return (await response.json()) as UserInfo;
  } catch {
    return null;
  }
}

export function isApiKeyToken(token: string): boolean {
  return token.startsWith("vf_");
}

export function isApiKeyIdentity(identity: AuthIdentity): identity is ApiKeyIdentity {
  return "type" in identity && identity.type === "apiKey";
}

async function validateApiKey(token: string): Promise<boolean> {
  if (!isApiKeyToken(token)) return false;

  try {
    const url = new URL(`${getApiUrl()}/projects`);
    url.searchParams.set("limit", "1");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

export async function validateCredential(token: string): Promise<AuthIdentity | null> {
  if (!token) return null;

  if (isApiKeyToken(token)) {
    return (await validateApiKey(token)) ? { authenticated: true, type: "apiKey" } : null;
  }

  return validateToken(token);
}

async function promptAuthMethod(): Promise<AuthMethod> {
  console.log();
  console.log("  " + dim("Choose authentication method:"));
  console.log();

  let selectedIndex = 0;

  function drawOptions(): void {
    for (let i = 0; i < AUTH_OPTIONS.length; i++) {
      const opt = AUTH_OPTIONS[i]!;
      console.log(
        i === selectedIndex ? "  " + brand("❯") + " " + opt.label : "    " + muted(opt.label),
      );
    }
  }

  function redrawOptions(): void {
    writeStdout(`\x1b[${AUTH_OPTIONS.length}A`);
    for (let i = 0; i < AUTH_OPTIONS.length; i++) {
      writeStdout("\x1b[2K\x1b[1B");
    }
    writeStdout(`\x1b[${AUTH_OPTIONS.length}A`);
    drawOptions();
  }

  drawOptions();

  setRawMode(true);
  const reader = getStdinReader();
  const dec = new TextDecoder();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return "google";

      const key = dec.decode(value);

      if (key === "\x03") return "token"; // Ctrl+C - default to token (will prompt)
      if (key === "\r" || key === "\n") return AUTH_OPTIONS[selectedIndex]?.id ?? "token";

      if (key === "\x1b[A" || key === "k") {
        selectedIndex = Math.max(0, selectedIndex - 1);
        redrawOptions();
        continue;
      }

      if (key === "\x1b[B" || key === "j") {
        selectedIndex = Math.min(AUTH_OPTIONS.length - 1, selectedIndex + 1);
        redrawOptions();
        continue;
      }

      if (key >= "1" && key <= "4") {
        return AUTH_OPTIONS[Number.parseInt(key, 10) - 1]?.id ?? "token";
      }
    }
  } finally {
    reader.releaseLock();
    setRawMode(false);
  }
}

async function loginWithOAuth(provider: "google" | "github" | "microsoft"): Promise<string | null> {
  console.log();

  if (!canOpenBrowser()) {
    console.log("  " + warning("Browser login not available in this environment."));
    console.log("  " + dim("Please use the API token option instead."));
    return null;
  }

  console.log("  " + dim("Starting authentication server..."));

  const state = createOAuthState();
  let server: Awaited<ReturnType<typeof startCallbackServer>>;
  try {
    server = await startCallbackServer(DEFAULT_CALLBACK_PORT, { expectedState: state });
  } catch (e) {
    console.log("  " + error(`Failed to start server: ${e}`));
    return null;
  }

  const callbackUrl = getCallbackUrl(server.port);
  const authUrl = createOAuthAuthorizationUrl(provider, callbackUrl, state);

  console.log("  " + brand("Opening browser to log in..."));
  console.log();

  try {
    await openBrowser(authUrl);
  } catch {
    console.log("  " + dim("Could not open browser automatically."));
    console.log("  " + dim("Please use the API token option instead."));
  }

  console.log("  " + muted("Waiting for login..."));

  try {
    const result = await server.waitForCallback(DEFAULT_LOGIN_TIMEOUT_MS);

    if (result.error) {
      console.log();
      console.log("  " + error("✗") + " Login failed: " + result.error);
      return null;
    }

    if (!result.token) {
      console.log();
      console.log("  " + error("✗") + " No token received");
      return null;
    }

    return result.token;
  } catch (e) {
    console.log();
    console.log("  " + error("✗") + " " + (e instanceof Error ? e.message : String(e)));
    return null;
  } finally {
    await server.stop();
  }
}

async function loginWithToken(): Promise<string | null> {
  console.log();
  console.log("  " + brand("Enter your API token"));
  console.log("  " + dim("You can get a token from veryfront.com/settings/api-keys"));
  console.log();

  const token = (await promptUser("  API token: ")).trim();
  if (!token) {
    console.log();
    console.log("  " + error("✗") + " No token entered");
    return null;
  }

  return token;
}

export async function login(method?: AuthMethod): Promise<AuthIdentity | null> {
  const authMethod = method ?? (isTTY() ? await promptAuthMethod() : "token");

  let token: string | null = null;
  switch (authMethod) {
    case "google":
    case "github":
    case "microsoft":
      token = await loginWithOAuth(authMethod);
      break;
    case "token":
      token = await loginWithToken();
      break;
  }

  if (!token) return null;

  console.log("  " + dim("Validating token..."));

  const identity = await validateCredential(token);
  if (!identity) {
    console.log();
    console.log("  " + error("✗") + " Invalid token");
    return null;
  }

  await saveToken(token);
  console.log();
  console.log(
    isApiKeyIdentity(identity)
      ? "  " + success("✓") + " Authenticated with an API key"
      : "  " + success("✓") + " Logged in as " + brand(identity.email),
  );
  return identity;
}

export async function ensureAuthenticated(
  env: EnvironmentConfig = getEnvironmentConfig(),
): Promise<AuthIdentity | null> {
  if (env.apiToken) {
    const credential = await validateCredential(env.apiToken);
    if (credential) return credential;
    console.log("  " + warning("Warning: VERYFRONT_API_TOKEN is invalid"));
  }

  const storedToken = await readToken(env);
  if (storedToken) {
    const credential = await validateCredential(storedToken);
    if (credential) return credential;
    await deleteToken(env);
    console.log("  " + warning("Session expired. Please log in again."));
  }

  if (!isTTY()) {
    cliLogger.error("Not logged in. Set VERYFRONT_API_TOKEN or run in interactive mode.");
    return null;
  }

  return login();
}

export async function logout(): Promise<void> {
  await deleteToken();
  console.log();
  console.log("  " + success("✓") + " Logged out");
}

async function reportCredential(
  token: string,
  source: "env" | "token-store",
): Promise<AuthIdentity | null> {
  const credential = await validateCredential(token);
  if (!credential) return null;

  if (!isApiKeyIdentity(credential)) {
    const userInfo = credential;
    if (isJsonMode()) {
      await outputJson(createSuccessEnvelope("whoami", { ...userInfo, source }));
      return userInfo;
    }

    console.log();
    console.log("  " + success("✓") + " Logged in as " + brand(userInfo.email));
  } else {
    if (isJsonMode()) {
      await outputJson(createSuccessEnvelope("whoami", {
        authenticated: true,
        credential_type: "api_key",
        source,
      }));
      return { authenticated: true, type: "apiKey" };
    }

    console.log();
    console.log("  " + success("✓") + " Authenticated with an API key");
  }

  console.log(
    "  " + dim(
      source === "env" ? "(via VERYFRONT_API_TOKEN)" : `Token stored at: ${getTokenLocation()}`,
    ),
  );
  return credential;
}

export async function whoami(
  env: EnvironmentConfig = getEnvironmentConfig(),
): Promise<AuthIdentity | null> {
  if (env.apiToken) {
    const result = await reportCredential(env.apiToken, "env");
    if (result) return result;
  }

  const storedToken = await readToken();
  if (storedToken) {
    const result = await reportCredential(storedToken, "token-store");
    if (result) return result;
  }

  if (isJsonMode()) {
    await outputJson(createSuccessEnvelope("whoami", { authenticated: false }));
    return null;
  }

  console.log();
  console.log("  " + warning("✗") + " Not logged in");
  console.log("  " + dim("Run 'veryfront login' to authenticate"));

  // Show provider tokens
  try {
    const { listProviderTokens } = await import("./provider-store.ts");
    const providers = await listProviderTokens();
    for (const p of providers) {
      console.log("  " + success("✓") + ` ${p} API key configured`);
    }
  } catch {
    // Provider store not available
  }

  return null;
}

export { deleteToken, hasToken, readToken, saveToken };
