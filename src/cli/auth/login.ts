import { cliLogger } from "@veryfront/utils";
import { getEnv } from "@veryfront/platform/compat/process.ts";
import { cyan, dim, green, red, yellow } from "@veryfront/compat/console";
import { deleteToken, getTokenLocation, hasToken, readToken, saveToken } from "./token-store.ts";
import { getCallbackUrl, startCallbackServer } from "./callback-server.ts";
import { canOpenBrowser, openBrowser } from "./browser.ts";
import { createSpinner, getColorEnabled, isTTY, promptUser } from "../utils/index.ts";
import { DEFAULT_LOGIN_TIMEOUT_MS, getApiUrl } from "./constants.ts";

export type AuthMethod = "google" | "github" | "microsoft" | "token";

export interface UserInfo {
  id: string;
  email: string;
  name?: string;
}

function useColor() {
  const enabled = getColorEnabled();
  return (fn: (s: string) => string, s: string) => (enabled ? fn(s) : s);
}

export async function validateToken(token: string): Promise<UserInfo | null> {
  try {
    const response = await fetch(`${getApiUrl()}/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!response.ok) return null;
    return await response.json() as UserInfo;
  } catch {
    return null;
  }
}

async function promptAuthMethod(): Promise<AuthMethod> {
  const c = useColor();
  cliLogger.info("");
  cliLogger.info(c(cyan, "How would you like to authenticate?"));
  cliLogger.info("");
  cliLogger.info(`  ${c(cyan, "1.")} Login with Google ${c(dim, "(opens browser)")}`);
  cliLogger.info(`  ${c(cyan, "2.")} Login with GitHub ${c(dim, "(opens browser)")}`);
  cliLogger.info(`  ${c(cyan, "3.")} Login with Microsoft ${c(dim, "(opens browser)")}`);
  cliLogger.info(`  ${c(cyan, "4.")} Enter API token manually`);
  cliLogger.info("");

  const response = await promptUser("Enter choice (1-4):");
  switch (response.trim()) {
    case "1":
      return "google";
    case "2":
      return "github";
    case "3":
      return "microsoft";
    default:
      return "token";
  }
}

async function loginWithOAuth(provider: "google" | "github" | "microsoft"): Promise<string | null> {
  const c = useColor();

  if (!canOpenBrowser()) {
    cliLogger.info("");
    cliLogger.info(c(yellow, "Browser login not available in this environment."));
    cliLogger.info("Please use the API token option instead.");
    return null;
  }

  const spinner = createSpinner("Starting authentication server...");
  spinner.start();

  let server;
  try {
    server = await startCallbackServer();
  } catch (error) {
    spinner.stop();
    cliLogger.error(`Failed to start authentication server: ${error}`);
    return null;
  }

  const callbackUrl = getCallbackUrl(server.port);
  const authUrl = `${getApiUrl()}/auth/${provider}-login?redirect_uri=${
    encodeURIComponent(callbackUrl)
  }`;

  spinner.stop();
  cliLogger.info("");
  cliLogger.info(c(cyan, "Opening browser to log in..."));
  cliLogger.info(c(dim, `If the browser doesn't open, visit:`));
  cliLogger.info(c(dim, authUrl));
  cliLogger.info("");

  try {
    await openBrowser(authUrl);
  } catch {
    cliLogger.info(c(yellow, "Could not open browser automatically."));
    cliLogger.info("Please open the URL above manually.");
  }

  const waitSpinner = createSpinner("Waiting for login...");
  waitSpinner.start();

  try {
    const result = await server.waitForCallback(DEFAULT_LOGIN_TIMEOUT_MS);

    if (result.error) {
      waitSpinner.stop();
      cliLogger.info("");
      cliLogger.info(`${c(red, "✗")} Login failed: ${result.error}`);
      return null;
    }

    if (!result.token) {
      waitSpinner.stop();
      cliLogger.info("");
      cliLogger.info(`${c(red, "✗")} No token received`);
      return null;
    }

    waitSpinner.stop();
    return result.token;
  } catch (error) {
    waitSpinner.stop();
    cliLogger.info("");
    cliLogger.info(`${c(red, "✗")} ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    await server.stop();
  }
}

async function loginWithToken(): Promise<string | null> {
  const c = useColor();
  cliLogger.info("");
  cliLogger.info(c(cyan, "Enter your API token"));
  cliLogger.info(c(dim, "You can get a token from veryfront.com/settings/api-keys"));
  cliLogger.info("");

  const token = await promptUser("API token:");
  if (!token.trim()) {
    cliLogger.info("");
    cliLogger.info(`${c(red, "✗")} No token entered`);
    return null;
  }
  return token.trim();
}

export async function login(method?: AuthMethod): Promise<UserInfo | null> {
  const c = useColor();
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

  const spinner = createSpinner("Validating token...");
  spinner.start();

  const userInfo = await validateToken(token);
  if (!userInfo) {
    spinner.stop();
    cliLogger.info("");
    cliLogger.info(`${c(red, "✗")} Invalid token`);
    return null;
  }

  await saveToken(token);
  spinner.stop();
  cliLogger.info("");
  cliLogger.info(`${c(green, "✓")} Logged in as ${c(cyan, userInfo.email)}`);
  return userInfo;
}

export async function ensureAuthenticated(): Promise<UserInfo | null> {
  const c = useColor();

  const envToken = getEnv("VERYFRONT_API_TOKEN");
  if (envToken) {
    const userInfo = await validateToken(envToken);
    if (userInfo) return userInfo;
    cliLogger.info(c(yellow, "Warning: VERYFRONT_API_TOKEN is invalid"));
  }

  const storedToken = await readToken();
  if (storedToken) {
    const userInfo = await validateToken(storedToken);
    if (userInfo) return userInfo;
    await deleteToken();
    cliLogger.info(c(yellow, "Session expired. Please log in again."));
  }

  if (!isTTY()) {
    cliLogger.error("Not logged in. Set VERYFRONT_API_TOKEN or run in interactive mode.");
    return null;
  }

  return login();
}

export async function logout(): Promise<void> {
  const c = useColor();
  await deleteToken();
  cliLogger.info(`${c(green, "✓")} Logged out`);
}

export async function whoami(): Promise<UserInfo | null> {
  const c = useColor();

  const envToken = getEnv("VERYFRONT_API_TOKEN");
  if (envToken) {
    const userInfo = await validateToken(envToken);
    if (userInfo) {
      cliLogger.info(`${c(green, "✓")} Logged in as ${c(cyan, userInfo.email)}`);
      cliLogger.info(c(dim, "  (via VERYFRONT_API_TOKEN)"));
      return userInfo;
    }
  }

  const storedToken = await readToken();
  if (storedToken) {
    const userInfo = await validateToken(storedToken);
    if (userInfo) {
      cliLogger.info(`${c(green, "✓")} Logged in as ${c(cyan, userInfo.email)}`);
      cliLogger.info(c(dim, `  Token stored at: ${getTokenLocation()}`));
      return userInfo;
    }
  }

  cliLogger.info(`${c(yellow, "✗")} Not logged in`);
  cliLogger.info(c(dim, "  Run 'veryfront login' to authenticate"));
  return null;
}

export { deleteToken, hasToken, readToken, saveToken };
