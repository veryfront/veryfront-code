import { cliLogger } from "#cli/utils";
import { writeStdout } from "veryfront/platform";
import { getStdinReader, setRawMode } from "veryfront/platform";
import { type EnvironmentConfig, getEnvironmentConfig } from "veryfront/config";
import { deleteToken, getTokenLocation, hasToken, readToken, saveToken } from "./token-store.ts";
import { getCallbackUrl, startCallbackServer } from "./callback-server.ts";
import { canOpenBrowser, openBrowser } from "./browser.ts";
import { isTTY, promptUser } from "../utils/index.ts";
import { brand, dim, error, muted, success, warning } from "../ui/colors.ts";
import { DEFAULT_LOGIN_TIMEOUT_MS, getApiUrl } from "../shared/constants.ts";

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

  let server: Awaited<ReturnType<typeof startCallbackServer>>;
  try {
    server = await startCallbackServer();
  } catch (e) {
    console.log("  " + error(`Failed to start server: ${e}`));
    return null;
  }

  const callbackUrl = getCallbackUrl(server.port);
  const authUrl = `${getApiUrl()}/auth/${provider}?redirect_uri=${encodeURIComponent(callbackUrl)}`;

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

export async function ensureAuthenticated(
  env: EnvironmentConfig = getEnvironmentConfig(),
): Promise<UserInfo | null> {
  if (env.apiToken) {
    const userInfo = await validateToken(env.apiToken);
    if (userInfo) return userInfo;
    console.log("  " + warning("Warning: VERYFRONT_API_TOKEN is invalid"));
  }

  const storedToken = await readToken(env);
  if (storedToken) {
    const userInfo = await validateToken(storedToken);
    if (userInfo) return userInfo;
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

export async function whoami(
  env: EnvironmentConfig = getEnvironmentConfig(),
): Promise<UserInfo | null> {
  if (env.apiToken) {
    const userInfo = await validateToken(env.apiToken);
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
