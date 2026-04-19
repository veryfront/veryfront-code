/**
 * Integration Generator
 *
 * Generates new service integration scaffolds with interactive prompts.
 * Creates connector.json, API client, OAuth routes, token store, and tool skeletons.
 */

import { join } from "#std/path.ts";
import { cyan, dim, green } from "#cli/ui";
import { cliLogger } from "#cli/utils";
import { createFileSystem, type FileSystem } from "veryfront/platform";
import { ensureDir } from "../../utils/fs.ts";
import { isInteractive as checkIsInteractive, promptSync } from "veryfront/platform";
import { isCiEnv, isDenoTestingEnv } from "veryfront/config";
import {
  getNonInteractiveConfig,
  getToolExecuteBody,
  getToolInputSchema,
  type IntegrationConfig,
  normalizeTokenAuthMethod,
  parseAdditionalAuthParams,
  parseBooleanOption,
  parseScopes,
  type TokenAuthMethod,
  validateIntegrationName,
} from "./integration-generator-helpers.ts";
import { select } from "../../utils/terminal-select.ts";

let fs: FileSystem;

export interface IntegrationGeneratorOptions {
  /** Integration name (lowercase, e.g., "twilio") */
  name?: string;
  /** Display name (e.g., "Twilio") */
  displayName?: string;
  /** Authentication type */
  authType?: "oauth2" | "api-key";
  /** API base URL */
  apiBaseUrl?: string;
  /** OAuth authorization URL (for oauth2) */
  authorizationUrl?: string;
  /** OAuth token URL (for oauth2) */
  tokenUrl?: string;
  /** OAuth scopes (comma-separated) */
  scopes?: string;
  /** OAuth token auth method */
  tokenAuthMethod?: TokenAuthMethod;
  /** Additional OAuth auth URL params (comma-separated key=value pairs) */
  additionalAuthParams?: string;
  /** Enable PKCE for OAuth authorization code flow */
  usePKCE?: boolean;
  /** Skip interactive prompts */
  skipPrompts?: boolean;
}

function canRunPrompts(): boolean {
  return !(isCiEnv() || isDenoTestingEnv()) && checkIsInteractive();
}

function promptText(question: string, defaultValue?: string): Promise<string> {
  const defaultHint = defaultValue ? dim(` (${defaultValue})`) : "";
  const fullQuestion = `${cyan("?")} ${question}${defaultHint}`;
  const input = promptSync(fullQuestion);
  return Promise.resolve(input?.trim() || defaultValue || "");
}

export async function generateIntegration(
  projectDir: string,
  options: IntegrationGeneratorOptions = {},
): Promise<void> {
  fs = createFileSystem();

  const shouldPrompt = !options.skipPrompts && canRunPrompts();
  const config = shouldPrompt
    ? await getInteractiveConfig(options)
    : getNonInteractiveConfig(options);

  await createIntegrationFiles(projectDir, config);

  console.log("");
  console.log(green("Integration created successfully!"));
  console.log("");
  console.log("Files created:");
  console.log(`  ${cyan("ai/integrations/" + config.name + "/")} - Integration directory`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Add your ${config.envVarPrefix}_* environment variables to .env`);
  if (config.authType === "oauth2") {
    console.log(`  2. Configure OAuth app in ${config.displayName} developer portal`);
    console.log(`  3. Set callback URL to: /api/auth/${config.name}/callback`);
  }
  console.log(`  4. Customize the generated tools in ai/integrations/${config.name}/tools/`);
  console.log("");
}

async function getInteractiveConfig(
  options: IntegrationGeneratorOptions,
): Promise<IntegrationConfig> {
  console.log("");
  console.log(green("Integration Generator"));
  console.log("Let's create a new service integration.\n");

  const name = options.name ??
    await promptText("Integration name (lowercase, e.g., twilio, zendesk):");
  validateIntegrationName(name);

  const displayName = options.displayName ??
    await promptText(
      "Display name:",
      name.charAt(0).toUpperCase() + name.slice(1),
    );

  let authType = options.authType;
  if (!authType) {
    const selected = await select(
      "Authentication type:",
      [
        { value: "oauth2", label: "OAuth 2.0", description: "For services with OAuth flow" },
        { value: "api-key", label: "API Key", description: "For services with API key auth" },
      ],
      0,
    );
    authType = (selected as "oauth2" | "api-key" | null) ?? "oauth2";
  }

  const apiBaseUrl = options.apiBaseUrl ??
    await promptText("API base URL:", `https://api.${name}.com`);

  let authorizationUrl: string | undefined;
  let tokenUrl: string | undefined;
  let scopes: string[] = [];
  let tokenAuthMethod: TokenAuthMethod = normalizeTokenAuthMethod(options.tokenAuthMethod);
  let additionalAuthParams: Record<string, string> = parseAdditionalAuthParams(
    options.additionalAuthParams,
  );
  let usePKCE = parseBooleanOption(options.usePKCE, false);

  if (authType === "oauth2") {
    authorizationUrl = options.authorizationUrl ??
      await promptText(
        "OAuth authorization URL:",
        `https://${name}.com/oauth/authorize`,
      );

    tokenUrl = options.tokenUrl ??
      await promptText("OAuth token URL:", `https://${name}.com/oauth/token`);

    const scopesInput = options.scopes ??
      await promptText("OAuth scopes (comma-separated, or leave empty):");
    scopes = scopesInput ? parseScopes(scopesInput) : [];

    tokenAuthMethod = options.tokenAuthMethod
      ? normalizeTokenAuthMethod(options.tokenAuthMethod)
      : normalizeTokenAuthMethod(
        await promptText(
          "OAuth token auth method (request_body, body, basic, client_secret_basic, client_secret_post):",
          "request_body",
        ),
      );

    usePKCE = options.usePKCE !== undefined
      ? parseBooleanOption(options.usePKCE, false)
      : parseBooleanOption(
        await promptText("Use PKCE? (y/N):", "n"),
        false,
      );

    additionalAuthParams = options.additionalAuthParams
      ? parseAdditionalAuthParams(options.additionalAuthParams)
      : parseAdditionalAuthParams(
        await promptText(
          "Additional auth URL params (key=value,key=value, or leave empty):",
        ),
      );
  }

  return {
    name,
    displayName,
    authType,
    apiBaseUrl,
    authorizationUrl,
    tokenUrl,
    scopes,
    tokenAuthMethod,
    additionalAuthParams,
    usePKCE,
    envVarPrefix: name.toUpperCase().replace(/-/g, "_"),
  };
}

async function createIntegrationFiles(
  projectDir: string,
  config: IntegrationConfig,
): Promise<void> {
  const baseDir = join(projectDir, "ai", "integrations", config.name);

  await ensureDir(baseDir);
  await ensureDir(join(baseDir, "lib"));
  await ensureDir(join(baseDir, "tools"));

  if (config.authType === "oauth2") {
    await ensureDir(join(projectDir, "app", "api", "auth", config.name));
    await ensureDir(join(projectDir, "app", "api", "auth", config.name, "callback"));
    await createOAuth2Files(projectDir, baseDir, config);
  } else {
    await createApiKeyFiles(baseDir, config);
  }

  await createClientFile(baseDir, config);
  await createToolSkeletons(baseDir, config);
  await createEnvExample(projectDir, config);
}

async function createOAuth2Files(
  projectDir: string,
  baseDir: string,
  config: IntegrationConfig,
): Promise<void> {
  const tokenAuthMethodLiteral = JSON.stringify(config.tokenAuthMethod);
  const additionalAuthParamsLiteral = JSON.stringify(config.additionalAuthParams, null, 2);
  const usePKCELiteral = JSON.stringify(config.usePKCE);
  const pkceCookieName = `${config.name}_pkce_verifier`;

  const tokenStore = `/**
 * Token storage for ${config.displayName} OAuth
 */

type TokenAuthMethod =
  | "basic"
  | "body"
  | "client_secret_basic"
  | "client_secret_post"
  | "request_body";

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

let tokenData: TokenData | null = null;
const TOKEN_AUTH_METHOD: TokenAuthMethod = ${tokenAuthMethodLiteral};

export function setTokens(access: string, refresh?: string, expiresIn?: number): void {
  tokenData = {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
  };
}

export async function getAccessToken(): Promise<string | null> {
  if (!tokenData) return null;

  // Check if token is expired and attempt refresh
  if (tokenData.expiresAt && Date.now() > tokenData.expiresAt) {
    if (tokenData.refreshToken) {
      const refreshed = await refreshAccessToken(tokenData.refreshToken);
      if (refreshed) {
        setTokens(refreshed.accessToken, refreshed.refreshToken, refreshed.expiresIn);
        return refreshed.accessToken;
      }
    }
    clearTokens();
    return null;
  }

  return tokenData.accessToken;
}

function getClientCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.${config.envVarPrefix}_CLIENT_ID;
  const clientSecret = process.env.${config.envVarPrefix}_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function buildTokenRequest(
  body: Record<string, string>,
): { headers: HeadersInit; body: URLSearchParams } | null {
  const credentials = getClientCredentials();
  if (!credentials) return null;

  const { clientId, clientSecret } = credentials;
  const headers: HeadersInit = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const params = new URLSearchParams(body);

  switch (TOKEN_AUTH_METHOD) {
    case "basic":
    case "client_secret_basic":
      headers.Authorization = \`Basic \${btoa(\`\${clientId}:\${clientSecret}\`)}\`;
      break;
    case "body":
    case "client_secret_post":
    case "request_body":
      params.set("client_id", clientId);
      params.set("client_secret", clientSecret);
      break;
  }

  return { headers, body: params };
}

function toTokenResponse(data: any, fallbackRefreshToken?: string): TokenResponse | null {
  const accessToken = typeof data?.access_token === "string" ? data.access_token : null;
  if (!accessToken) return null;

  const expiresIn = typeof data?.expires_in === "number"
    ? data.expires_in
    : typeof data?.expires_in === "string"
    ? Number(data.expires_in)
    : undefined;

  return {
    accessToken,
    refreshToken: typeof data?.refresh_token === "string"
      ? data.refresh_token
      : fallbackRefreshToken,
    expiresIn: Number.isFinite(expiresIn) ? expiresIn : undefined,
  };
}

async function requestToken(
  body: Record<string, string>,
  fallbackRefreshToken?: string,
): Promise<TokenResponse | null> {
  const request = buildTokenRequest(body);
  if (!request) return null;

  try {
    const response = await fetch("${config.tokenUrl}", {
      method: "POST",
      headers: request.headers,
      body: request.body,
    });

    if (!response.ok) return null;

    const data = await response.json();
    return toTokenResponse(data, fallbackRefreshToken);
  } catch {
    return null;
  }
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  codeVerifier?: string,
): Promise<TokenResponse | null> {
  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  };

  if (codeVerifier) {
    body.code_verifier = codeVerifier;
  }

  return await requestToken(body);
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenResponse | null> {
  const refreshed = await requestToken(
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    },
    refreshToken,
  );

  if (!refreshed) {
    clearTokens();
  }

  return refreshed;
}

export function clearTokens(): void {
  tokenData = null;
}
`;
  const tokenStorePath = join(baseDir, "lib", "token-store.ts");
  await fs.writeTextFile(tokenStorePath, tokenStore);
  cliLogger.debug(`Created ${tokenStorePath}`);

  const oauthRoute = `/**
 * ${config.displayName} OAuth initialization route
 */

const SCOPE = ${JSON.stringify(config.scopes.join(" "))};
const ADDITIONAL_AUTH_PARAMS = ${additionalAuthParamsLiteral};
const USE_PKCE = ${usePKCELiteral};
const PKCE_COOKIE_NAME = ${JSON.stringify(pkceCookieName)};

function redirectWithCookie(location: string, cookie?: string): Response {
  const headers = new Headers({ Location: location });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "");
}

async function createPKCEPair(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = toBase64Url(verifierBytes);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = toBase64Url(new Uint8Array(digest));
  return { verifier, challenge };
}

export async function GET(): Promise<Response> {
  const clientId = process.env.${config.envVarPrefix}_CLIENT_ID;

  if (!clientId) {
    return Response.json(
      { error: "${config.envVarPrefix}_CLIENT_ID not configured" },
      { status: 500 }
    );
  }

  const redirectUri = \`\${process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/auth/${config.name}/callback\`;
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });

  if (SCOPE) {
    params.set("scope", SCOPE);
  }

  for (const [key, value] of Object.entries(ADDITIONAL_AUTH_PARAMS)) {
    params.set(key, value);
  }

  let pkceCookie: string | undefined;
  if (USE_PKCE) {
    const { verifier, challenge } = await createPKCEPair();
    params.set("code_challenge", challenge);
    params.set("code_challenge_method", "S256");
    pkceCookie =
      \`\${PKCE_COOKIE_NAME}=\${encodeURIComponent(verifier)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600\`;
  }

  return redirectWithCookie(\`${config.authorizationUrl}?\${params}\`, pkceCookie);
}
`;
  await fs.writeTextFile(
    join(projectDir, "app", "api", "auth", config.name, "route.ts"),
    oauthRoute,
  );
  cliLogger.debug("Created OAuth init route");

  const callbackRoute = `/**
 * ${config.displayName} OAuth callback route
 */

import {
  exchangeCodeForTokens,
  setTokens,
} from "../../../../ai/integrations/${config.name}/lib/token-store.ts";

const USE_PKCE = ${usePKCELiteral};
const PKCE_COOKIE_NAME = ${JSON.stringify(pkceCookieName)};

function redirectWithCookie(location: string, cookie?: string): Response {
  const headers = new Headers({ Location: location });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function clearPKCECookie(): string {
  return \`\${PKCE_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0\`;
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const name = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1);
    if (!name) continue;

    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }

  return cookies;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    console.error("${config.displayName} OAuth error:", error);
    return redirectWithCookie("/?error=" + encodeURIComponent(error), clearPKCECookie());
  }

  if (!code) {
    return redirectWithCookie("/?error=no_code", clearPKCECookie());
  }

  const redirectUri = \`\${process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/auth/${config.name}/callback\`;
  let codeVerifier: string | undefined;

  if (USE_PKCE) {
    codeVerifier = parseCookies(request.headers.get("cookie") ?? "")[PKCE_COOKIE_NAME];
    if (!codeVerifier) {
      return redirectWithCookie("/?error=missing_pkce_verifier", clearPKCECookie());
    }
  }

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri, codeVerifier);

    if (!tokens) {
      console.error("Token exchange failed");
      return redirectWithCookie("/?error=token_exchange_failed", clearPKCECookie());
    }

    setTokens(tokens.accessToken, tokens.refreshToken, tokens.expiresIn);

    return redirectWithCookie("/?connected=${config.name}", clearPKCECookie());
  } catch (error) {
    console.error("OAuth callback error:", error);
    return redirectWithCookie("/?error=callback_failed", clearPKCECookie());
  }
}
`;
  await fs.writeTextFile(
    join(projectDir, "app", "api", "auth", config.name, "callback", "route.ts"),
    callbackRoute,
  );
  cliLogger.debug("Created OAuth callback route");
}

async function createApiKeyFiles(baseDir: string, config: IntegrationConfig): Promise<void> {
  const tokenStore = `/**
 * API key accessor for ${config.displayName}
 */

export function getApiKey(): string | null {
  return process.env.${config.envVarPrefix}_API_KEY || null;
}

export function requireApiKey(): string {
  const key = getApiKey();
  if (!key) {
    throw new Error("${config.envVarPrefix}_API_KEY not configured");
  }
  return key;
}
`;
  const tokenStorePath = join(baseDir, "lib", "token-store.ts");
  await fs.writeTextFile(tokenStorePath, tokenStore);
  cliLogger.debug(`Created ${tokenStorePath}`);
}

async function createClientFile(baseDir: string, config: IntegrationConfig): Promise<void> {
  const tokenImport = config.authType === "oauth2"
    ? `import { getAccessToken } from "./token-store.ts";`
    : `import { requireApiKey } from "./token-store.ts";`;

  const tokenCheck = config.authType === "oauth2"
    ? `const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with ${config.displayName}. Please connect your account.");
  }`
    : `const apiKey = requireApiKey();`;

  const authHeader = config.authType === "oauth2"
    ? `"Authorization": \`Bearer \${token}\``
    : `"Authorization": \`Bearer \${apiKey}\``;

  const client = `/**
 * ${config.displayName} API Client
 */

${tokenImport}

const API_BASE_URL = "${config.apiBaseUrl}";

interface ${config.displayName}Response<T> {
  data?: T;
  error?: string;
}

/**
 * Make an authenticated request to the ${config.displayName} API
 */
async function ${config.name}Fetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  ${tokenCheck}

  const response = await fetch(\`\${API_BASE_URL}\${endpoint}\`, {
    ...options,
    headers: {
      ${authHeader},
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(\`${config.displayName} API error: \${response.status} \${error}\`);
  }

  return response.json();
}

// ============================================================================
// API Methods - Customize these for your integration
// ============================================================================

/**
 * List items from ${config.displayName}
 */
export async function listItems(options?: {
  limit?: number;
  offset?: number;
}): Promise<unknown[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));

  const query = params.toString() ? \`?\${params}\` : "";
  return ${config.name}Fetch<unknown[]>(\`/items\${query}\`);
}

/**
 * Get a single item by ID
 */
export async function getItem(id: string): Promise<unknown> {
  return ${config.name}Fetch<unknown>(\`/items/\${id}\`);
}

/**
 * Create a new item
 */
export async function createItem(data: Record<string, unknown>): Promise<unknown> {
  return ${config.name}Fetch<unknown>("/items", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Search items
 */
export async function searchItems(query: string): Promise<unknown[]> {
  return ${config.name}Fetch<unknown[]>(\`/search?q=\${encodeURIComponent(query)}\`);
}
`;
  await fs.writeTextFile(join(baseDir, "lib", `${config.name}-client.ts`), client);
  cliLogger.debug("Created API client");
}

async function createToolSkeletons(baseDir: string, config: IntegrationConfig): Promise<void> {
  const tools = [
    {
      id: `list-${config.name}-items`,
      name: `List ${config.displayName} Items`,
      description: `List items from ${config.displayName}`,
      file: "list-items.ts",
    },
    {
      id: `get-${config.name}-item`,
      name: `Get ${config.displayName} Item`,
      description: `Get a specific item from ${config.displayName}`,
      file: "get-item.ts",
    },
    {
      id: `search-${config.name}`,
      name: `Search ${config.displayName}`,
      description: `Search for items in ${config.displayName}`,
      file: "search.ts",
    },
  ];

  for (const tool of tools) {
    const inputSchema = getToolInputSchema(tool.file);
    const executeBody = getToolExecuteBody(tool.file);

    const toolContent = `/**
 * ${tool.name}
 */

import { tool } from "veryfront/tool";
import { z } from "zod";
import { listItems, getItem, searchItems } from "../lib/${config.name}-client.ts";

export default tool({
  id: "${tool.id}",
  description: "${tool.description}",
  inputSchema: z.object({
    ${inputSchema}
  }),
  execute: async (input) => {
    try {
      ${executeBody}
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});
`;
    await fs.writeTextFile(join(baseDir, "tools", tool.file), toolContent);
    cliLogger.debug(`Created tool: ${tool.file}`);
  }
}

async function createEnvExample(projectDir: string, config: IntegrationConfig): Promise<void> {
  const envExamplePath = join(projectDir, ".env.example");

  const envContent = config.authType === "oauth2"
    ? `
# ${config.displayName} OAuth
${config.envVarPrefix}_CLIENT_ID=your_client_id
${config.envVarPrefix}_CLIENT_SECRET=your_client_secret
`
    : `
# ${config.displayName} API
${config.envVarPrefix}_API_KEY=your_api_key
`;

  try {
    const existing = await fs.readTextFile(envExamplePath);
    if (existing.includes(config.envVarPrefix)) return;

    await fs.writeTextFile(envExamplePath, existing + envContent);
    cliLogger.debug("Updated .env.example");
  } catch {
    await fs.writeTextFile(envExamplePath, `# Environment Variables${envContent}`);
    cliLogger.debug("Created .env.example");
  }
}
