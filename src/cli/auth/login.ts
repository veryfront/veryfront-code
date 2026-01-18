import { cliLogger } from "@veryfront/utils";
import { getEnv, writeStdout } from "@veryfront/platform/compat/process.ts";
import { getStdinReader, setRawMode } from "@veryfront/platform/compat/stdin.ts";
import { deleteToken, getTokenLocation, hasToken, readToken, saveToken } from "./token-store.ts";
import { getCallbackUrl, startCallbackServer } from "./callback-server.ts";
import { canOpenBrowser, openBrowser } from "./browser.ts";
import { isTTY, promptUser } from "../utils/index.ts";
import { brand, dim, error, muted, success, warning } from "../ui/colors.ts";
import { DEFAULT_LOGIN_TIMEOUT_MS, getApiUrl } from "./constants.ts";

export type AuthMethod = "google" | "github" | "microsoft" | "token";

export interface UserInfo {
  id: string;
  email: string;
  name?: string;
}

const AUTH_OPTIONS: { id: AuthMethod; label: string }[] = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
  { id: "microsoft", label: "Microsoft" },
  { id: "token", label: "API Token" },
];

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
  console.log();
  console.log("  " + dim("Choose authentication method:"));
  console.log();

  let selectedIndex = 0;

  function drawOptions() {
    for (let i = 0; i < AUTH_OPTIONS.length; i++) {
      const opt = AUTH_OPTIONS[i]!;
      if (i === selectedIndex) {
        console.log("  " + brand("❯") + " " + opt.label);
      } else {
        console.log("    " + muted(opt.label));
      }
    }
  }

  drawOptions();

  setRawMode(true);
  const reader = getStdinReader();
  const dec = new TextDecoder();
  let result: AuthMethod = "google";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const key = dec.decode(value);

      if (key === "\x03") {
        // Ctrl+C - default to token (will prompt)
        result = "token";
        break;
      } else if (key === "\r" || key === "\n") {
        result = AUTH_OPTIONS[selectedIndex]?.id ?? "token";
        break;
      } else if (key === "\x1b[A" || key === "k") {
        selectedIndex = Math.max(0, selectedIndex - 1);
      } else if (key === "\x1b[B" || key === "j") {
        selectedIndex = Math.min(AUTH_OPTIONS.length - 1, selectedIndex + 1);
      } else if (key >= "1" && key <= "4") {
        result = AUTH_OPTIONS[parseInt(key) - 1]?.id ?? "token";
        break;
      }

      // Redraw options
      writeStdout(`\x1b[${AUTH_OPTIONS.length}A`);
      for (let i = 0; i < AUTH_OPTIONS.length; i++) {
        writeStdout("\x1b[2K\x1b[1B");
      }
      writeStdout(`\x1b[${AUTH_OPTIONS.length}A`);
      drawOptions();
    }
  } finally {
    reader.releaseLock();
    setRawMode(false);
  }

  return result;
}

async function loginWithOAuth(provider: "google" | "github" | "microsoft"): Promise<string | null> {
  console.log();

  if (!canOpenBrowser()) {
    console.log("  " + warning("Browser login not available in this environment."));
    console.log("  " + dim("Please use the API token option instead."));
    return null;
  }

  console.log("  " + dim("Starting authentication server..."));

  let server;
  try {
    server = await startCallbackServer();
  } catch (err) {
    console.log("  " + error(`Failed to start server: ${err}`));
    return null;
  }

  const callbackUrl = getCallbackUrl(server.port);
  const authUrl = `${getApiUrl()}/auth/${provider}-login?redirect_uri=${
    encodeURIComponent(callbackUrl)
  }`;

  console.log("  " + brand("Opening browser to log in..."));
  console.log();
  console.log("  " + dim("If the browser doesn't open, visit:"));
  console.log("  " + dim(authUrl));
  console.log();

  try {
    await openBrowser(authUrl);
  } catch {
    console.log("  " + dim("Could not open browser automatically."));
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
  } catch (err) {
    console.log();
    console.log("  " + error("✗") + " " + (err instanceof Error ? err.message : String(err)));
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

  const token = await promptUser("  API token: ");
  if (!token.trim()) {
    console.log();
    console.log("  " + error("✗") + " No token entered");
    return null;
  }
  return token.trim();
}

export async function login(method?: AuthMethod): Promise<UserInfo | null> {
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

  const userInfo = await validateToken(token);
  if (!userInfo) {
    console.log();
    console.log("  " + error("✗") + " Invalid token");
    return null;
  }

  await saveToken(token);
  console.log();
  console.log("  " + success("✓") + " Logged in as " + brand(userInfo.email));
  return userInfo;
}

export async function ensureAuthenticated(): Promise<UserInfo | null> {
  const envToken = getEnv("VERYFRONT_API_TOKEN");
  if (envToken) {
    const userInfo = await validateToken(envToken);
    if (userInfo) return userInfo;
    console.log("  " + warning("Warning: VERYFRONT_API_TOKEN is invalid"));
  }

  const storedToken = await readToken();
  if (storedToken) {
    const userInfo = await validateToken(storedToken);
    if (userInfo) return userInfo;
    await deleteToken();
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

export async function whoami(): Promise<UserInfo | null> {
  const envToken = getEnv("VERYFRONT_API_TOKEN");
  if (envToken) {
    const userInfo = await validateToken(envToken);
    if (userInfo) {
      console.log();
      console.log("  " + success("✓") + " Logged in as " + brand(userInfo.email));
      console.log("  " + dim("(via VERYFRONT_API_TOKEN)"));
      return userInfo;
    }
  }

  const storedToken = await readToken();
  if (storedToken) {
    const userInfo = await validateToken(storedToken);
    if (userInfo) {
      console.log();
      console.log("  " + success("✓") + " Logged in as " + brand(userInfo.email));
      console.log("  " + dim(`Token stored at: ${getTokenLocation()}`));
      return userInfo;
    }
  }

  console.log();
  console.log("  " + warning("✗") + " Not logged in");
  console.log("  " + dim("Run 'veryfront login' to authenticate"));
  return null;
}

export { deleteToken, hasToken, readToken, saveToken };
