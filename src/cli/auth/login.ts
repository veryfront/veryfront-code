/**
 * CLI authentication flow
 *
 * Handles OAuth login (Google, GitHub) and manual API token entry.
 * Implements Claude Code-style browser-based authentication.
 *
 * @module cli/auth/login
 */

import { cliLogger } from "@veryfront/utils";
import { getEnv } from "@veryfront/platform/compat/process.ts";
import { cyan, dim, green, red, yellow } from "@veryfront/compat/console";
import { readToken, saveToken, deleteToken, hasToken, getTokenLocation } from "./token-store.ts";
import { startCallbackServer, getCallbackUrl } from "./callback-server.ts";
import { openBrowser, canOpenBrowser } from "./browser.ts";
import {
  createSpinner,
  promptUser,
  isTTY,
  getColorEnabled,
} from "../utils/index.ts";

/**
 * Authentication method options
 */
export type AuthMethod = "google" | "github" | "token";

/**
 * User info returned from /api/me
 */
export interface UserInfo {
  id: string;
  email: string;
  name?: string;
}

/**
 * Default API URL
 */
const DEFAULT_API_URL = "https://api.veryfront.com";

/**
 * Get the API URL from environment or default
 */
function getApiUrl(): string {
  return getEnv("VERYFRONT_API_URL") || DEFAULT_API_URL;
}

/**
 * Validate a token by calling /api/me
 */
export async function validateToken(token: string): Promise<UserInfo | null> {
  const apiUrl = getApiUrl();

  try {
    const response = await fetch(`${apiUrl}/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data as UserInfo;
  } catch {
    return null;
  }
}

/**
 * Prompt user to select authentication method
 */
async function promptAuthMethod(): Promise<AuthMethod> {
  const useColor = getColorEnabled();
  const c = (fn: (s: string) => string, s: string) => (useColor ? fn(s) : s);

  cliLogger.info("");
  cliLogger.info(c(cyan, "How would you like to authenticate?"));
  cliLogger.info("");
  cliLogger.info(`  ${c(cyan, "1.")} Login with Google ${c(dim, "(opens browser)")}`);
  cliLogger.info(`  ${c(cyan, "2.")} Login with GitHub ${c(dim, "(opens browser)")}`);
  cliLogger.info(`  ${c(cyan, "3.")} Enter API token manually`);
  cliLogger.info("");

  const response = await promptUser("Enter choice (1-3):");
  const choice = response.trim();

  switch (choice) {
    case "1":
      return "google";
    case "2":
      return "github";
    case "3":
    default:
      return "token";
  }
}

/**
 * Login using OAuth (Google or GitHub)
 */
async function loginWithOAuth(provider: "google" | "github"): Promise<string | null> {
  const useColor = getColorEnabled();
  const c = (fn: (s: string) => string, s: string) => (useColor ? fn(s) : s);

  // Check if browser can be opened
  if (!canOpenBrowser()) {
    cliLogger.info("");
    cliLogger.info(c(yellow, "Browser login not available in this environment."));
    cliLogger.info("Please use the API token option instead.");
    return null;
  }

  // Start callback server
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
  const apiUrl = getApiUrl();
  const authUrl = `${apiUrl}/auth/${provider}-login?redirect_uri=${encodeURIComponent(callbackUrl)}`;

  spinner.stop();

  cliLogger.info("");
  cliLogger.info(c(cyan, "Opening browser to log in..."));
  cliLogger.info(c(dim, `If the browser doesn't open, visit:`));
  cliLogger.info(c(dim, authUrl));
  cliLogger.info("");

  // Open browser
  try {
    await openBrowser(authUrl);
  } catch (error) {
    cliLogger.info(c(yellow, "Could not open browser automatically."));
    cliLogger.info("Please open the URL above manually.");
  }

  // Wait for callback
  const waitSpinner = createSpinner("Waiting for login...");
  waitSpinner.start();

  try {
    const result = await server.waitForCallback(120000);

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
    const message = error instanceof Error ? error.message : String(error);
    cliLogger.info("");
    cliLogger.info(`${c(red, "✗")} ${message}`);
    return null;
  } finally {
    await server.stop();
  }
}

/**
 * Login by entering an API token manually
 */
async function loginWithToken(): Promise<string | null> {
  const useColor = getColorEnabled();
  const c = (fn: (s: string) => string, s: string) => (useColor ? fn(s) : s);

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

/**
 * Perform the login flow
 *
 * @param method - Optional method to use (skips prompt if provided)
 * @returns The authenticated user info, or null if login failed
 */
export async function login(method?: AuthMethod): Promise<UserInfo | null> {
  const useColor = getColorEnabled();
  const c = (fn: (s: string) => string, s: string) => (useColor ? fn(s) : s);

  // Prompt for method if not provided
  const authMethod = method ?? (isTTY() ? await promptAuthMethod() : "token");

  // Get token based on method
  let token: string | null = null;

  switch (authMethod) {
    case "google":
    case "github":
      token = await loginWithOAuth(authMethod);
      break;
    case "token":
      token = await loginWithToken();
      break;
  }

  if (!token) {
    return null;
  }

  // Validate token
  const spinner = createSpinner("Validating token...");
  spinner.start();

  const userInfo = await validateToken(token);

  if (!userInfo) {
    spinner.stop();
    cliLogger.info("");
    cliLogger.info(`${c(red, "✗")} Invalid token`);
    return null;
  }

  // Save token
  await saveToken(token);
  spinner.stop();

  cliLogger.info("");
  cliLogger.info(`${c(green, "✓")} Logged in as ${c(cyan, userInfo.email)}`);

  return userInfo;
}

/**
 * Ensure user is authenticated
 *
 * Checks for existing token first, then prompts for login if needed.
 *
 * @returns The authenticated user info, or null if login failed
 */
export async function ensureAuthenticated(): Promise<UserInfo | null> {
  const useColor = getColorEnabled();
  const c = (fn: (s: string) => string, s: string) => (useColor ? fn(s) : s);

  // Check environment variable first (for CI/CD)
  const envToken = getEnv("VERYFRONT_API_TOKEN");
  if (envToken) {
    const userInfo = await validateToken(envToken);
    if (userInfo) {
      return userInfo;
    }
    cliLogger.info(c(yellow, "Warning: VERYFRONT_API_TOKEN is invalid"));
  }

  // Check stored token
  const storedToken = await readToken();
  if (storedToken) {
    const userInfo = await validateToken(storedToken);
    if (userInfo) {
      return userInfo;
    }
    // Token is invalid, delete it
    await deleteToken();
    cliLogger.info(c(yellow, "Session expired. Please log in again."));
  }

  // Prompt for login
  if (!isTTY()) {
    cliLogger.error("Not logged in. Set VERYFRONT_API_TOKEN or run in interactive mode.");
    return null;
  }

  return login();
}

/**
 * Logout - clear stored token
 */
export async function logout(): Promise<void> {
  const useColor = getColorEnabled();
  const c = (fn: (s: string) => string, s: string) => (useColor ? fn(s) : s);

  await deleteToken();
  cliLogger.info(`${c(green, "✓")} Logged out`);
}

/**
 * Get current user info
 */
export async function whoami(): Promise<UserInfo | null> {
  const useColor = getColorEnabled();
  const c = (fn: (s: string) => string, s: string) => (useColor ? fn(s) : s);

  // Check environment variable first
  const envToken = getEnv("VERYFRONT_API_TOKEN");
  if (envToken) {
    const userInfo = await validateToken(envToken);
    if (userInfo) {
      cliLogger.info(`${c(green, "✓")} Logged in as ${c(cyan, userInfo.email)}`);
      cliLogger.info(c(dim, "  (via VERYFRONT_API_TOKEN)"));
      return userInfo;
    }
  }

  // Check stored token
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

// Re-export token utilities
export { readToken, saveToken, deleteToken, hasToken };
