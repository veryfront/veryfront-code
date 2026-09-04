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
import { type ApiTokenSource, resolveApiCredentialCandidatesForAuth } from "../shared/config.ts";
import {
  createErrorEnvelope,
  createSuccessEnvelope,
  isJsonMode,
  outputJson,
} from "../shared/json-output.ts";
import { isInteractive } from "../shared/interactive.ts";
import { getEnvSource } from "veryfront/utils/env-loader";
import { basename, isAbsolute, relative } from "veryfront/platform/path";
import { cwd, getEnv } from "veryfront/platform";

const applyIntrinsic = Reflect.apply;
const stringTrim = String.prototype.trim;
const stringStartsWith = String.prototype.startsWith;
const stringReplace = String.prototype.replace;

function trimString(value: string): string {
  return applyIntrinsic(stringTrim, value, []) as string;
}

function replaceString(value: string, pattern: RegExp, replacement: string): string {
  return applyIntrinsic(stringReplace, value, [pattern, replacement]) as string;
}

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
export function formatEnvSourcePathForDisplay(file: string, currentCwd = cwd()): string {
  // Repo-relative only: AGENTS.md forbids local absolute paths in user-facing
  // output. A file outside the working directory, including a Windows
  // cross-drive result, degrades to its name rather than exposing the layout.
  // A bare filename stays bare (`.env`); anything nested is prefixed so it
  // reads unambiguously as a path (`./config/.env`). The test is for a
  // separator rather than a leading ".", because a dot-*directory* also starts
  // with one, so `.config/.env` would otherwise be the only nested path printed
  // without the prefix.
  const rel = relative(currentCwd, file);
  const shown = rel === "." || rel.startsWith("..") || isAbsolute(rel)
    ? basename(file)
    : /[/\\]/.test(rel) && !rel.startsWith("./")
    ? `./${rel}`
    : rel;
  return shown;
}

function describeApiTokenSource(token: string): string {
  const origin = getEnvSource("VERYFRONT_API_TOKEN");
  if (origin.source !== "env-file" || getEnv("VERYFRONT_API_TOKEN") !== token) {
    return "(via VERYFRONT_API_TOKEN)";
  }

  return `(via VERYFRONT_API_TOKEN from ${formatEnvSourcePathForDisplay(origin.file)})`;
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
  throwOnCredentialValidationUnavailable?: boolean;
  /** Reuse a caller-owned cancellation or deadline across validation attempts. */
  signal?: AbortSignal;
  /**
   * Abort the request after this many milliseconds. Callers that must stay
   * responsive pass a deadline; omitting it keeps the previous unbounded
   * behaviour for callers that are already the user's main action.
   */
  timeoutMs?: number;
  /** Host-owned API origin paired with a private credential. */
  apiBaseUrl?: string;
  /** Host-owned transport used when a private credential crosses the project boundary. */
  transport?: typeof fetch;
}

/**
 * How long the bare-`login` preflight will wait on a credential check.
 *
 * That check is best-effort: it exists only to say "already logged in" instead
 * of prompting. A connection the API accepts but never answers would otherwise
 * block sign-in forever, so the check is bounded and a timeout simply falls
 * through to the normal flow.
 */
const DEFAULT_EXISTING_SESSION_TIMEOUT_MS = 5_000;
let existingSessionTimeoutMs = DEFAULT_EXISTING_SESSION_TIMEOUT_MS;

function loginIdentityData(
  identity: AuthIdentity,
  source: ApiTokenSource,
): Record<string, unknown> {
  const displayedSource = source === "env-file" ? "env" : source;
  if (isApiKeyIdentity(identity)) {
    return {
      authenticated: true,
      credential_type: "api_key",
      source: displayedSource,
    };
  }

  return { ...identity, source: displayedSource };
}

async function outputLoginAuthenticationRequiredJson(): Promise<void> {
  await outputJson(createErrorEnvelope("login", {
    code: "AUTHENTICATION_ERROR",
    slug: "authentication-required",
    registrySlug: "authentication-required",
    message: "Not logged in. Set VERYFRONT_API_TOKEN or run in interactive mode.",
  }));
}

type CredentialValidationUnavailableKind = "network" | "service" | "timeout";

class CredentialValidationUnavailableError extends Error {
  override name = "CredentialValidationUnavailableError";

  constructor(
    readonly kind: CredentialValidationUnavailableKind,
    readonly status?: number,
  ) {
    super("Could not validate existing login credentials");
  }
}

function isCredentialTimeoutFailure(error: unknown): boolean {
  return error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError");
}

function isCredentialRejectionStatus(status: number): boolean {
  return status === 401 || status === 403;
}

function isUserInfo(value: unknown): value is UserInfo {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<UserInfo>;
  return typeof candidate.id === "string" && candidate.id.trim() !== "" &&
    typeof candidate.email === "string" && candidate.email.trim() !== "";
}

async function outputLoginExplicitMethodJson(): Promise<void> {
  await outputJson(createErrorEnvelope("login", {
    code: "USAGE_ERROR",
    slug: "invalid-arguments",
    registrySlug: "invalid-argument",
    message: "Explicit login methods are not supported with --json.",
  }));
}

async function outputLoginValidationUnavailableJson(
  failure: CredentialValidationUnavailableError,
): Promise<void> {
  if (failure.kind === "timeout") {
    await outputJson(createErrorEnvelope("login", {
      code: "TIMEOUT_ERROR",
      slug: "timeout-error",
      registrySlug: "timeout-error",
      message: "Timed out while checking existing login credentials. Try again.",
    }));
    return;
  }

  if (failure.kind === "network") {
    await outputJson(createErrorEnvelope("login", {
      code: "NETWORK_ERROR",
      slug: "network-error",
      registrySlug: "network-error",
      message: "Could not reach the Veryfront API while checking existing login credentials.",
    }));
    return;
  }

  await outputJson(createErrorEnvelope("login", {
    code: "API_CLIENT_ERROR",
    slug: "api-client-error",
    registrySlug: "api-client-error",
    message: "Veryfront API could not validate existing login credentials.",
    context: failure.status ? { status: failure.status } : undefined,
  }));
}

/** Test seam: shrink the preflight deadline so a stall is observable quickly. */
export function __setExistingSessionTimeoutForTests(ms?: number): void {
  existingSessionTimeoutMs = ms ?? DEFAULT_EXISTING_SESSION_TIMEOUT_MS;
}

function requestSignal(options: CredentialValidationOptions): AbortSignal | undefined {
  return options.signal ?? (options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined);
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

function isCredentialNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError || isCredentialTimeoutFailure(error);
}

function throwNetworkError(): never {
  throw new NetworkError("Could not reach the Veryfront API");
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
  if (!trimString(token)) return null;

  try {
    const apiBaseUrl = options.apiBaseUrl ?? getApiUrl(env);
    const transport = options.transport ?? fetch;
    const response = await transport(`${replaceString(apiBaseUrl, /\/$/, "")}/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: requestSignal(options),
    });

    if (!response.ok) {
      // Consume response body to prevent resource leak
      await response.body?.cancel();
      if (
        options.throwOnCredentialValidationUnavailable &&
        !isCredentialRejectionStatus(response.status)
      ) {
        throw new CredentialValidationUnavailableError("service", response.status);
      }
      if (options.throwOnNetworkError && response.status >= 500) throwNetworkError();
      return null;
    }

    try {
      const userInfo = await response.json();
      if (isUserInfo(userInfo)) return userInfo;
      if (options.throwOnCredentialValidationUnavailable) {
        throw new CredentialValidationUnavailableError("service", response.status);
      }
      return null;
    } catch (error) {
      if (options.throwOnCredentialValidationUnavailable) {
        if (error instanceof CredentialValidationUnavailableError) {
          throw error;
        }
        if (isCredentialTimeoutFailure(error)) {
          throw new CredentialValidationUnavailableError("timeout");
        }
        if (error instanceof TypeError) {
          throw new CredentialValidationUnavailableError("network");
        }
        throw new CredentialValidationUnavailableError("service", response.status);
      }
      throw error;
    }
  } catch (e) {
    if (options.throwOnCredentialValidationUnavailable) {
      if (e instanceof CredentialValidationUnavailableError) {
        throw e;
      }
      if (isCredentialTimeoutFailure(e)) {
        throw new CredentialValidationUnavailableError("timeout");
      }
      if (e instanceof TypeError) {
        throw new CredentialValidationUnavailableError("network");
      }
      throw e;
    }
    if (e instanceof NetworkError) throw e;
    if (options.throwOnNetworkError && isCredentialNetworkFailure(e)) throwNetworkError();
    return null;
  }
}

export function isApiKeyToken(token: string): boolean {
  return applyIntrinsic(stringStartsWith, token, ["vf_"]) as boolean;
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
    const apiBaseUrl = options.apiBaseUrl ?? getApiUrl(env);
    const transport = options.transport ?? fetch;
    const url = new URL(`${replaceString(apiBaseUrl, /\/$/, "")}/projects`);
    url.searchParams.set("limit", "1");
    const response = await transport(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: requestSignal(options),
    });
    await response.body?.cancel();
    if (!response.ok) {
      if (
        options.throwOnCredentialValidationUnavailable &&
        !isCredentialRejectionStatus(response.status)
      ) {
        throw new CredentialValidationUnavailableError("service", response.status);
      }
      if (options.throwOnNetworkError && response.status >= 500) throwNetworkError();
      return false;
    }
    return true;
  } catch (e) {
    if (options.throwOnCredentialValidationUnavailable) {
      if (e instanceof CredentialValidationUnavailableError) {
        throw e;
      }
      if (isCredentialTimeoutFailure(e)) {
        throw new CredentialValidationUnavailableError("timeout");
      }
      if (e instanceof TypeError) {
        throw new CredentialValidationUnavailableError("network");
      }
      throw e;
    }
    if (e instanceof NetworkError) throw e;
    if (options.throwOnNetworkError && isCredentialNetworkFailure(e)) throwNetworkError();
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

function writeConfigFileSwitchingGuidance(): void {
  console.log(
    "  " +
      dim("Remove or replace apiToken in veryfront.json before signing in with another method."),
  );
}

function writeEnvironmentConfigFileSwitchingGuidance(): void {
  console.log(
    "  " +
      dim("Remove or replace apiToken in veryfront.json after unsetting VERYFRONT_API_TOKEN."),
  );
}

function writeAuthoritativeCredentialRejectedMessage(
  source: "config-file" | "environment",
  hasConfigToken: boolean,
): void {
  console.log();
  if (source === "environment") {
    console.log("  " + error("✗") + " VERYFRONT_API_TOKEN was rejected by the Veryfront API.");
    console.log(
      "  " +
        dim(
          "Unset VERYFRONT_API_TOKEN or replace the variable before signing in with another method.",
        ),
    );
    if (hasConfigToken) writeEnvironmentConfigFileSwitchingGuidance();
    return;
  }

  console.log(
    "  " + error("✗") + " apiToken from veryfront.json was rejected by the Veryfront API.",
  );
  writeConfigFileSwitchingGuidance();
}

function credentialSourceForDisplay(source: "config-file" | "environment"): string {
  return source === "environment" ? "VERYFRONT_API_TOKEN" : "apiToken from veryfront.json";
}

function writeAuthoritativeCredentialUnavailableMessage(
  source: "config-file" | "environment",
  failure: CredentialValidationUnavailableError,
  hasConfigToken: boolean,
): void {
  const credential = credentialSourceForDisplay(source);
  console.log();
  if (failure.kind === "timeout") {
    console.log(
      "  " + error("✗") + ` Timed out while checking ${credential} with the Veryfront API.`,
    );
  } else if (failure.kind === "network") {
    console.log(
      "  " + error("✗") + ` Could not reach the Veryfront API while checking ${credential}.`,
    );
  } else {
    const status = failure.status ? ` (${failure.status})` : "";
    console.log(
      "  " + error("✗") + ` Veryfront API could not validate ${credential}${status}.`,
    );
  }
  console.log("  " + dim("Try again before signing in with another method."));

  if (source === "environment") {
    console.log(
      "  " + dim("Unset VERYFRONT_API_TOKEN before signing in with another method."),
    );
    if (hasConfigToken) writeEnvironmentConfigFileSwitchingGuidance();
    return;
  }

  writeConfigFileSwitchingGuidance();
}

/**
 * Report an already-valid session, or null when there is nothing usable.
 *
 * Returns a sentinel when JSON or human output already explained why login
 * must stop instead of falling through to lower-priority credentials or a new
 * login that later commands will not use.
 */
async function describeExistingSession(
  env: EnvironmentConfig,
  projectDir: string = cwd(),
): Promise<AuthIdentity | "failure-output" | null> {
  const candidates = await resolveApiCredentialCandidatesForAuth(env, projectDir);
  if (candidates.length === 0) return null;
  const hasConfigToken = candidates.some((candidate) => candidate.apiTokenSource === "config-file");
  let hasStoredToken = candidates.some((candidate) => candidate.apiTokenSource === "token-store");
  const signal = AbortSignal.timeout(existingSessionTimeoutMs);
  let unavailable: CredentialValidationUnavailableError | null = null;

  for (const { apiToken, apiTokenSource, authoritative, validationEnv } of candidates) {
    const source = apiTokenSource === "config-file"
      ? "config-file"
      : apiTokenSource === "token-store"
      ? "stored"
      : "environment";
    let identity: AuthIdentity | null;
    try {
      // Bounded: this preflight only decides whether to say "already logged in"
      // instead of prompting. An authoritative credential that cannot be
      // checked must still stop, because later commands will resolve it ahead
      // of any replacement login.
      identity = await validateCredential(apiToken, validationEnv, {
        signal,
        throwOnCredentialValidationUnavailable: true,
      });
    } catch (error) {
      if (error instanceof CredentialValidationUnavailableError) {
        unavailable ??= error;
        if (authoritative || apiTokenSource === "token-store") {
          if (!isJsonMode() && source !== "stored") {
            writeAuthoritativeCredentialUnavailableMessage(
              source,
              error,
              hasConfigToken,
            );
            return "failure-output";
          }
          break;
        }
        continue;
      }
      throw error;
    }
    if (!identity) {
      if (apiTokenSource === "token-store") {
        await deleteToken(env);
        hasStoredToken = false;
      }
      if (authoritative) {
        if (!isJsonMode()) {
          if (source !== "stored") {
            writeAuthoritativeCredentialRejectedMessage(source, hasConfigToken);
            return "failure-output";
          }
        }
        break;
      }
      continue;
    }

    if (isJsonMode()) {
      await outputJson(createSuccessEnvelope(
        "login",
        loginIdentityData(identity, apiTokenSource),
      ));
      return identity;
    }

    console.log();
    console.log(
      "  ✓ " +
        (isApiKeyIdentity(identity)
          ? "Already authenticated with an API key"
          : "Already logged in as " + brand(identity.email)),
    );
    // An environment credential is a valid session for every command, but this
    // path stores nothing, and `login` implies it did. The variable is often set
    // by a `.env` in the working directory the developer has forgotten about,
    // the case `whoami` now names, so the session ends at the directory
    // boundary. Say so rather than let them discover it elsewhere.
    if (source === "environment") {
      if (hasStoredToken) {
        console.log(
          "  " + dim("Using VERYFRONT_API_TOKEN; it takes precedence over a stored credential."),
        );
        console.log(
          "  " +
            dim(
              "Unset VERYFRONT_API_TOKEN before attempting to use the stored credential, or replace the variable to switch tokens.",
            ),
        );
      } else {
        console.log("  " + dim("Using VERYFRONT_API_TOKEN; no stored login was created."));
        console.log(
          "  " +
            dim(
              "Unset VERYFRONT_API_TOKEN before using another login method, or replace the variable to switch tokens.",
            ),
        );
      }
      if (hasConfigToken) writeEnvironmentConfigFileSwitchingGuidance();
    } else if (source === "config-file") {
      console.log(
        "  " +
          dim("Using apiToken from veryfront.json; it takes precedence over stored credentials."),
      );
      writeConfigFileSwitchingGuidance();
    }
    console.log(
      "  " +
        dim(
          "Run 'veryfront login --token' (or --google, --github, --microsoft) to sign in again.",
        ),
    );
    return identity;
  }

  if (isJsonMode() && unavailable) {
    await outputLoginValidationUnavailableJson(unavailable);
    return "failure-output";
  }
  return null;
}

export async function login(
  method?: AuthMethod,
  env: EnvironmentConfig = getEnvironmentConfig(),
  projectDir: string = cwd(),
): Promise<AuthIdentity | null> {
  if (isJsonMode() && method !== undefined) {
    await outputLoginExplicitMethodJson();
    return null;
  }

  // A bare `veryfront login` is the documented first step of the deploy
  // journey, and an already-authenticated developer ran it only to be asked for
  // a token they do not need. Report the session instead. An explicit method is
  // intent to sign in again, so account switching still works — and a session
  // that no longer validates falls through to the normal flow.
  if (method === undefined) {
    const existing = await describeExistingSession(env, projectDir);
    if (existing === "failure-output") return null;
    if (existing) return existing;
    if (isJsonMode()) {
      await outputLoginAuthenticationRequiredJson();
      return null;
    }
  }

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
  projectDir: string = cwd(),
): Promise<AuthIdentity | null> {
  const humanOutput = !isJsonMode();

  const candidates = await resolveApiCredentialCandidatesForAuth(env, projectDir);
  for (const candidate of candidates) {
    let credential: AuthIdentity | null;
    try {
      credential = await validateCredential(
        candidate.apiToken,
        candidate.validationEnv,
        candidate.apiTokenSource === "token-store"
          ? { throwOnCredentialValidationUnavailable: true }
          : undefined,
      );
    } catch (error) {
      if (
        candidate.apiTokenSource === "token-store" &&
        error instanceof CredentialValidationUnavailableError
      ) {
        return null;
      }
      throw error;
    }
    if (credential) return credential;

    if (candidate.apiTokenSource === "env" && humanOutput) {
      console.log("  " + warning("Warning: VERYFRONT_API_TOKEN is invalid"));
    }
    if (candidate.apiTokenSource === "config-file" && humanOutput) {
      console.log("  " + warning("Warning: apiToken from veryfront.json is invalid"));
    }
    if (candidate.authoritative) return null;
    if (candidate.apiTokenSource === "token-store") {
      await deleteToken(env);
      if (humanOutput) {
        console.log("  " + warning("Session expired. Please log in again."));
      }
    }
  }

  if (!humanOutput) return null;

  if (!isTTY() || !isInteractive()) {
    cliLogger.error("Not logged in. Set VERYFRONT_API_TOKEN or run in interactive mode.");
    return null;
  }

  return login(undefined, env, projectDir);
}

const CREDENTIAL_VALIDATION_UNAVAILABLE = Symbol("credential-validation-unavailable");

export async function logout(env: EnvironmentConfig = getEnvironmentConfig()): Promise<void> {
  await deleteToken(env);
  console.log();
  console.log("  ✓ Logged out");
}

async function reportCredential(
  token: string,
  source: ApiTokenSource,
  env: EnvironmentConfig,
): Promise<AuthIdentity | typeof CREDENTIAL_VALIDATION_UNAVAILABLE | null> {
  let credential: AuthIdentity | null;
  try {
    credential = await validateCredential(token, env, {
      throwOnCredentialValidationUnavailable: true,
    });
  } catch (error) {
    if (error instanceof CredentialValidationUnavailableError) {
      return CREDENTIAL_VALIDATION_UNAVAILABLE;
    }
    throw error;
  }
  if (!credential) {
    if (source === "token-store") await deleteToken(env);
    return null;
  }
  const displayedSource = source === "env-file" ? "env" : source;

  if (!isApiKeyIdentity(credential)) {
    const userInfo = credential;
    if (isJsonMode()) {
      await outputJson(createSuccessEnvelope("whoami", { ...userInfo, source: displayedSource }));
      return userInfo;
    }

    console.log();
    console.log("  ✓ Logged in as " + brand(userInfo.email));
  } else {
    if (isJsonMode()) {
      await outputJson(createSuccessEnvelope("whoami", {
        authenticated: true,
        credential_type: "api_key",
        source: displayedSource,
      }));
      return { authenticated: true, type: "apiKey" };
    }

    console.log();
    console.log("  ✓ Authenticated with an API key");
  }

  console.log(
    "  " + dim(
      source === "env" || source === "env-file"
        ? describeApiTokenSource(token)
        : source === "config-file"
        ? "apiToken from veryfront.json"
        : `Token stored at: ${getTokenLocation(env)}`,
    ),
  );
  return credential;
}

export async function whoami(
  env: EnvironmentConfig = getEnvironmentConfig(),
): Promise<AuthIdentity | null> {
  const candidates = await resolveApiCredentialCandidatesForAuth(env);
  for (const candidate of candidates) {
    const result = await reportCredential(
      candidate.apiToken,
      candidate.apiTokenSource,
      candidate.validationEnv,
    );
    if (result === CREDENTIAL_VALIDATION_UNAVAILABLE) break;
    if (result) return result;
    if (candidate.authoritative) break;
  }

  if (isJsonMode()) {
    await outputJson(createSuccessEnvelope("whoami", { authenticated: false }));
    return null;
  }

  console.log();
  console.log("  " + error("✗") + " Not logged in");
  console.log("  " + dim("Run 'veryfront login' to authenticate"));

  return null;
}

export { deleteToken, hasToken, readToken, saveToken };
