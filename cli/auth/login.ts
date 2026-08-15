import { cliLogger, exitProcess } from "#cli/utils";
import { type EnvironmentConfig, getEnvironmentConfig } from "veryfront/config";
import { deleteToken, getTokenLocation, hasToken, readToken, saveToken } from "./token-store.ts";
import { getCallbackUrl, startCallbackServer } from "./callback-server.ts";
import { canOpenBrowser, openBrowser } from "./browser.ts";
import { isTTY, promptUser } from "../utils/index.ts";
import { brand, dim, error, warning } from "../ui/colors.ts";
import { createSpinner, type SpinnerController } from "../ui/progress.ts";
import { PromptInterruptedError, select } from "../utils/terminal-select.ts";
import {
  API_KEYS_URL,
  DEFAULT_CALLBACK_PORT,
  DEFAULT_LOGIN_TIMEOUT_MS,
  getApiUrl,
} from "../shared/constants.ts";
import { createSuccessEnvelope, isJsonMode, outputJson } from "../shared/json-output.ts";
import { isInteractive } from "../shared/interactive.ts";
import { getEnvSource } from "#veryfront/utils/env-loader.ts";
import { relative } from "#veryfront/compat/path";
import { cwd } from "veryfront/platform";

/**
 * Describe where an API-token credential actually came from.
 *
 * `.env` files in the working directory are loaded into the environment, so a
 * token can arrive under `VERYFRONT_API_TOKEN` while that variable is unset in
 * the developer's shell. Reporting only the variable name sends them to check
 * something they can see is empty; naming the file ends the search. Identity is
 * directory-dependent for every command that infers a project from config, so
 * this is worth the extra clause.
 */
function describeApiTokenSource(): string {
  const origin = getEnvSource("VERYFRONT_API_TOKEN");
  if (origin.source !== "env-file") return "(via VERYFRONT_API_TOKEN)";

  // Repo-relative only: AGENTS.md forbids local absolute paths in user-facing
  // output. A file outside the working directory degrades to its name rather
  // than exposing the layout above it.
  const rel = relative(cwd(), origin.file);
  const shown = !rel || rel.startsWith("..")
    ? origin.file.split("/").pop() ?? origin.file
    : rel.startsWith(".")
    ? rel
    : `./${rel}`;
  return `(via VERYFRONT_API_TOKEN from ${shown})`;
}

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

export interface CredentialValidationOptions {
  throwOnNetworkError?: boolean;
}

const AUTH_OPTIONS: { id: AuthMethod; label: string }[] = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
  { id: "microsoft", label: "Microsoft" },
  { id: "token", label: "API Token" },
];

class NetworkError extends Error {
  override name = "NetworkError";
}

export function createOAuthState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createOAuthAuthorizationUrl(
  provider: "google" | "github" | "microsoft",
  callbackUrl: string,
  state: string,
  env: EnvironmentConfig = getEnvironmentConfig(),
): string {
  const stateBoundCallbackUrl = new URL(callbackUrl);
  stateBoundCallbackUrl.searchParams.set("state", state);

  const authUrl = new URL(`${getApiUrl(env).replace(/\/$/, "")}/auth/${provider}`);
  authUrl.searchParams.set("redirect_uri", stateBoundCallbackUrl.toString());
  authUrl.searchParams.set("state", state);
  return authUrl.toString();
}

export async function validateToken(
  token: string,
  env: EnvironmentConfig = getEnvironmentConfig(),
  options: CredentialValidationOptions = {},
): Promise<UserInfo | null> {
  if (!token.trim()) return null;

  try {
    const response = await fetch(`${getApiUrl(env).replace(/\/$/, "")}/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    if (!response.ok) {
      // Consume response body to prevent resource leak
      await response.body?.cancel();
      return null;
    }

    return (await response.json()) as UserInfo;
  } catch (e) {
    if (options.throwOnNetworkError && e instanceof TypeError) {
      throw new NetworkError("Could not reach the Veryfront API");
    }
    return null;
  }
}

export function isApiKeyToken(token: string): boolean {
  return token.startsWith("vf_");
}

export function isApiKeyIdentity(identity: AuthIdentity): identity is ApiKeyIdentity {
  return "type" in identity && identity.type === "apiKey";
}

async function validateApiKey(
  token: string,
  env: EnvironmentConfig = getEnvironmentConfig(),
  options: CredentialValidationOptions = {},
): Promise<boolean> {
  if (!isApiKeyToken(token)) return false;

  try {
    const url = new URL(`${getApiUrl(env).replace(/\/$/, "")}/projects`);
    url.searchParams.set("limit", "1");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    await response.body?.cancel();
    return response.ok;
  } catch (e) {
    if (options.throwOnNetworkError && e instanceof TypeError) {
      throw new NetworkError("Could not reach the Veryfront API");
    }
    return false;
  }
}

export async function validateCredential(
  token: string,
  env: EnvironmentConfig = getEnvironmentConfig(),
  options: CredentialValidationOptions = {},
): Promise<AuthIdentity | null> {
  if (!token) return null;

  if (isApiKeyToken(token)) {
    return (await validateApiKey(token, env, options))
      ? { authenticated: true, type: "apiKey" }
      : null;
  }

  return validateToken(token, env, options);
}

async function promptAuthMethod(): Promise<AuthMethod> {
  try {
    const result = await select(
      dim("Choose authentication method:"),
      AUTH_OPTIONS.map((o) => ({ value: o.id, label: o.label })),
      0,
      {
        showMarker: false,
        showInstructions: false,
        showDescriptions: false,
        interruptOnCtrlC: true,
        clearOnCancel: false,
      },
    );

    if (result === null) {
      exitProcess(130);
      return "token"; // unreachable
    }

    return result as AuthMethod;
  } catch (e) {
    if (e instanceof PromptInterruptedError) {
      exitProcess(130);
      return "token"; // unreachable
    }
    throw e;
  }
}

export async function openOAuthLogin(
  authUrl: string,
  spinner: SpinnerController,
  opener: (url: string) => Promise<void> = openBrowser,
): Promise<boolean> {
  try {
    await opener(authUrl);
    return true;
  } catch {
    spinner.stop();
    console.log();
    console.log(`  ${warning("!")} Could not open the browser.`);
    console.log(`  ${dim("Continue in your browser:")}`);
    console.log(`  ${brand(authUrl)}`);
    console.log();
    return false;
  }
}

async function loginWithOAuth(
  provider: "google" | "github" | "microsoft",
  env: EnvironmentConfig,
  spinner: SpinnerController,
): Promise<string | null> {
  if (!canOpenBrowser(env)) {
    spinner.stop();
    console.log("  " + warning("!") + " Browser login not available in this environment.");
    console.log("  " + dim("Please use the API token option instead."));
    return null;
  }

  const state = createOAuthState();
  let server: Awaited<ReturnType<typeof startCallbackServer>>;
  try {
    server = await startCallbackServer(DEFAULT_CALLBACK_PORT, { expectedState: state });
  } catch (e) {
    spinner.error(`Failed to start authentication server: ${e}`);
    return null;
  }

  const callbackUrl = getCallbackUrl(server.port);
  const authUrl = createOAuthAuthorizationUrl(provider, callbackUrl, state, env);

  spinner.update("Opening browser to log in...");
  const browserOpened = await openOAuthLogin(authUrl, spinner);
  if (browserOpened) {
    spinner.update("Waiting for login...");
  } else {
    console.log(`  ${dim("Waiting for login...")}`);
  }

  try {
    const result = await server.waitForCallback(DEFAULT_LOGIN_TIMEOUT_MS);

    if (result.error) {
      spinner.error(`Login failed: ${result.error}`);
      return null;
    }

    if (!result.token) {
      spinner.error("No token received");
      return null;
    }

    return result.token;
  } catch (e) {
    spinner.error(e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    await server.stop();
  }
}

async function loginWithToken(): Promise<string | null> {
  console.log();
  console.log("  " + brand("Enter your API token"));
  console.log("  " + dim(`You can get a token from ${API_KEYS_URL}`));
  console.log();

  const token = (await promptUser("  API token: ")).trim();
  if (!token) {
    console.log();
    console.log("  " + error("✗") + " No token entered");
    return null;
  }

  return token;
}

export async function login(
  method?: AuthMethod,
  env: EnvironmentConfig = getEnvironmentConfig(),
): Promise<AuthIdentity | null> {
  if (!isInteractive() && (method === undefined || method === "token")) {
    cliLogger.error("Not logged in. Set VERYFRONT_API_TOKEN or run in interactive mode.");
    return null;
  }

  const authMethod = method ?? (isTTY() ? await promptAuthMethod() : "token");

  if (authMethod === "google" || authMethod === "github" || authMethod === "microsoft") {
    const spinner = createSpinner("Starting authentication server...");
    const token = await loginWithOAuth(authMethod, env, spinner);
    if (!token) return null;

    spinner.update("Validating token...");
    let identity: AuthIdentity | null;
    try {
      identity = await validateCredential(token, env, { throwOnNetworkError: true });
    } catch (e) {
      if (e instanceof NetworkError) {
        spinner.stop();
        console.log();
        console.log("  " + error("✗") + " Could not reach the Veryfront API");
        console.log("  " + dim("Check your network connection and try again"));
        return null;
      }
      throw e;
    }

    if (!identity) {
      spinner.error("Invalid token");
      return null;
    }

    await saveToken(token, env);
    spinner.success(
      isApiKeyIdentity(identity)
        ? "Authenticated with an API key"
        : `Logged in as ${brand(identity.email)}`,
    );
    return identity;
  }

  // Token path: no spinner, plain text status
  const token = await loginWithToken();
  if (!token) return null;

  console.log("  " + dim("Validating token..."));

  let identity: AuthIdentity | null;
  try {
    identity = await validateCredential(token, env, { throwOnNetworkError: true });
  } catch (e) {
    if (e instanceof NetworkError) {
      console.log();
      console.log("  " + error("✗") + " Could not reach the Veryfront API");
      console.log("  " + dim("Check your network connection and try again"));
      return null;
    }
    throw e;
  }

  if (!identity) {
    console.log();
    console.log("  " + error("✗") + " Invalid token");
    return null;
  }

  await saveToken(token, env);
  console.log();
  console.log(
    isApiKeyIdentity(identity)
      ? "  ✓ Authenticated with an API key"
      : "  ✓ Logged in as " + brand(identity.email),
  );
  return identity;
}

export async function ensureAuthenticated(
  env: EnvironmentConfig = getEnvironmentConfig(),
): Promise<AuthIdentity | null> {
  const humanOutput = !isJsonMode();

  if (env.apiToken) {
    const credential = await validateCredential(env.apiToken, env);
    if (credential) return credential;
    if (humanOutput) {
      console.log("  " + warning("Warning: VERYFRONT_API_TOKEN is invalid"));
    }
  }

  const storedToken = await readToken(env);
  if (storedToken) {
    const credential = await validateCredential(storedToken, env);
    if (credential) return credential;
    await deleteToken(env);
    if (humanOutput) {
      console.log("  " + warning("Session expired. Please log in again."));
    }
  }

  if (!humanOutput) return null;

  if (!isTTY() || !isInteractive()) {
    cliLogger.error("Not logged in. Set VERYFRONT_API_TOKEN or run in interactive mode.");
    return null;
  }

  return login(undefined, env);
}

export async function logout(env: EnvironmentConfig = getEnvironmentConfig()): Promise<void> {
  await deleteToken(env);
  console.log();
  console.log("  ✓ Logged out");
}

async function reportCredential(
  token: string,
  source: "env" | "token-store",
  env: EnvironmentConfig,
): Promise<AuthIdentity | null> {
  const credential = await validateCredential(token, env);
  if (!credential) return null;

  if (!isApiKeyIdentity(credential)) {
    const userInfo = credential;
    if (isJsonMode()) {
      await outputJson(createSuccessEnvelope("whoami", { ...userInfo, source }));
      return userInfo;
    }

    console.log();
    console.log("  ✓ Logged in as " + brand(userInfo.email));
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
    console.log("  ✓ Authenticated with an API key");
  }

  console.log(
    "  " + dim(
      source === "env" ? describeApiTokenSource() : `Token stored at: ${getTokenLocation(env)}`,
    ),
  );
  return credential;
}

export async function whoami(
  env: EnvironmentConfig = getEnvironmentConfig(),
): Promise<AuthIdentity | null> {
  if (env.apiToken) {
    const result = await reportCredential(env.apiToken, "env", env);
    if (result) return result;
  }

  const storedToken = await readToken(env);
  if (storedToken) {
    const result = await reportCredential(storedToken, "token-store", env);
    if (result) return result;
  }

  if (isJsonMode()) {
    await outputJson(createSuccessEnvelope("whoami", { authenticated: false }));
    return null;
  }

  console.log();
  console.log("  " + error("✗") + " Not logged in");
  console.log("  " + dim("Run 'veryfront login' to authenticate"));

  // Show provider tokens
  try {
    const { listProviderTokens } = await import("./provider-store.ts");
    const providers = await listProviderTokens(env);
    for (const p of providers) {
      console.log(`  ✓ ${p} API key configured`);
    }
  } catch {
    // Provider store not available
  }

  return null;
}

export { deleteToken, hasToken, readToken, saveToken };
