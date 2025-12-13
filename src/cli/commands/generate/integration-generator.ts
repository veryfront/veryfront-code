
import { join } from "@std/path";
import { cyan, dim, green } from "@veryfront/compat/console";
import { cliLogger } from "@veryfront/utils";
import { createFileSystem, type FileSystem } from "../../../platform/compat/fs.ts";
import { getEnv, isInteractive as checkIsInteractive } from "../../../platform/compat/process.ts";
import { isDeno } from "../../../platform/compat/runtime.ts";
import { select } from "../../utils/terminal-select.ts";

export interface IntegrationGeneratorOptions {
  name?: string;
  displayName?: string;
  authType?: "oauth2" | "api-key";
  apiBaseUrl?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: string;
  skipPrompts?: boolean;
}

interface IntegrationConfig {
  name: string;
  displayName: string;
  authType: "oauth2" | "api-key";
  apiBaseUrl: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes: string[];
  envVarPrefix: string;
}

function canRunPrompts(): boolean {
  const disablePrompt = getEnv("CI") === "1" || getEnv("DENO_TESTING") === "1";
  return !disablePrompt && checkIsInteractive();
}

async function promptText(question: string, defaultValue?: string): Promise<string> {
  const defaultHint = defaultValue ? dim(` (${defaultValue})`) : "";
  console.log(`${cyan("?")} ${question}${defaultHint}`);

  const buf = new Uint8Array(1024);

  if (isDeno) {
    // @ts-ignore: Deno global
    const n = await Deno.stdin.read(buf);
    const input = new TextDecoder().decode(buf.subarray(0, n || 0)).trim();
    return input || defaultValue || "";
  } else {
    // Node.js environment
    const readline = await import("node:readline");
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question("  > ", (answer: string) => {
        rl.close();
        resolve(answer.trim() || defaultValue || "");
      });
    });
  }
}

export async function generateIntegration(
  projectDir: string,
  options: IntegrationGeneratorOptions = {},
): Promise<void> {
  const fs = createFileSystem();

  let config: IntegrationConfig;

  if (options.skipPrompts || !canRunPrompts()) {
    if (!options.name || !options.displayName || !options.authType) {
      throw new Error(
        "Non-interactive mode requires --name, --display-name, and --auth-type options",
      );
    }

    config = {
      name: options.name.toLowerCase(),
      displayName: options.displayName,
      authType: options.authType,
      apiBaseUrl: options.apiBaseUrl || `https://api.${options.name}.com`,
      authorizationUrl: options.authorizationUrl,
      tokenUrl: options.tokenUrl,
      scopes: options.scopes?.split(",").map((s) => s.trim()) || [],
      envVarPrefix: options.name.toUpperCase(),
    };
  } else {
    console.log("");
    console.log(green("Integration Generator"));
    console.log("Let's create a new service integration.\n");

    const name = options.name || await promptText(
      "Integration name (lowercase, e.g., twilio, zendesk):",
    );

    if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
      throw new Error("Integration name must be lowercase letters, numbers, and hyphens");
    }

    const displayName = options.displayName || await promptText(
      "Display name:",
      name.charAt(0).toUpperCase() + name.slice(1),
    );

    const authTypeChoice = options.authType || await select(
      "Authentication type:",
      [
        { value: "oauth2", label: "OAuth 2.0", description: "For services with OAuth flow" },
        { value: "api-key", label: "API Key", description: "For services with API key auth" },
      ],
      0,
    );

    const authType = (authTypeChoice as "oauth2" | "api-key") || "oauth2";

    const apiBaseUrl = options.apiBaseUrl || await promptText(
      "API base URL:",
      `https://api.${name}.com`,
    );

    let authorizationUrl: string | undefined;
    let tokenUrl: string | undefined;
    let scopes: string[] = [];

    if (authType === "oauth2") {
      authorizationUrl = options.authorizationUrl || await promptText(
        "OAuth authorization URL:",
        `https://${name}.com/oauth/authorize`,
      );

      tokenUrl = options.tokenUrl || await promptText(
        "OAuth token URL:",
        `https://${name}.com/oauth/token`,
      );

      const scopesInput = options.scopes || await promptText(
        "OAuth scopes (comma-separated, or leave empty):",
      );
      scopes = scopesInput ? scopesInput.split(",").map((s) => s.trim()) : [];
    }

    config = {
      name,
      displayName,
      authType,
      apiBaseUrl,
      authorizationUrl,
      tokenUrl,
      scopes,
      envVarPrefix: name.toUpperCase().replace(/-/g, "_"),
    };
  }

  await createIntegrationFiles(fs, projectDir, config);

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

async function createIntegrationFiles(
  fs: FileSystem,
  projectDir: string,
  config: IntegrationConfig,
): Promise<void> {
  const baseDir = join(projectDir, "ai", "integrations", config.name);

  await ensureDir(fs, baseDir);
  await ensureDir(fs, join(baseDir, "lib"));
  await ensureDir(fs, join(baseDir, "tools"));

  if (config.authType === "oauth2") {
    await ensureDir(fs, join(projectDir, "app", "api", "auth", config.name));
    await ensureDir(fs, join(projectDir, "app", "api", "auth", config.name, "callback"));
  }

  if (config.authType === "oauth2") {
    await createOAuth2Files(fs, projectDir, baseDir, config);
  } else {
    await createApiKeyFiles(fs, baseDir, config);
  }

  await createClientFile(fs, baseDir, config);
  await createToolSkeletons(fs, baseDir, config);
  await createEnvExample(fs, projectDir, config);
}

async function createOAuth2Files(
  fs: FileSystem,
  projectDir: string,
  baseDir: string,
  config: IntegrationConfig,
): Promise<void> {
  const tokenStore = `/**
 * Token storage for ${config.displayName} OAuth
 */

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

let tokenData: TokenData | null = null;

export function setTokens(access: string, refresh?: string, expiresIn?: number): void {
  tokenData = {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
  };
}

export async function getAccessToken(): Promise<string | null> {
  if (!tokenData) return null;

  if (tokenData.expiresAt && Date.now() > tokenData.expiresAt) {
    // TODO: Implement token refresh
    return null;
  }

  return tokenData.accessToken;
}

export function clearTokens(): void {
  tokenData = null;
}
`;
  await fs.writeTextFile(join(baseDir, "lib", "token-store.ts"), tokenStore);
  cliLogger.debug(`Created ${join(baseDir, "lib", "token-store.ts")}`);

  const oauthRoute = `/**
 * ${config.displayName} OAuth initialization route
 */

import { redirect } from "veryfront";

export function GET(): Response {
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
    ${config.scopes.length > 0 ? `scope: "${config.scopes.join(" ")}",` : '// scope: "read write",'}
  });

  return redirect(\`${config.authorizationUrl}?\${params}\`);
}
`;
  await fs.writeTextFile(
    join(projectDir, "app", "api", "auth", config.name, "route.ts"),
    oauthRoute,
  );
  cliLogger.debug(`Created OAuth init route`);

  const callbackRoute = `/**
 * ${config.displayName} OAuth callback route
 */

import { redirect } from "veryfront";
import { setTokens } from "../../../../ai/integrations/${config.name}/lib/token-store.ts";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    console.error("${config.displayName} OAuth error:", error);
    return redirect("/?error=" + encodeURIComponent(error));
  }

  if (!code) {
    return redirect("/?error=no_code");
  }

  const clientId = process.env.${config.envVarPrefix}_CLIENT_ID;
  const clientSecret = process.env.${config.envVarPrefix}_CLIENT_SECRET;
  const redirectUri = \`\${process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/auth/${config.name}/callback\`;

  try {
    const response = await fetch("${config.tokenUrl}", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId!,
        client_secret: clientSecret!,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Token exchange failed:", errorData);
      return redirect("/?error=token_exchange_failed");
    }

    const data = await response.json();
    setTokens(data.access_token, data.refresh_token, data.expires_in);

    return redirect("/?connected=${config.name}");
  } catch (err) {
    console.error("OAuth callback error:", err);
    return redirect("/?error=callback_failed");
  }
}
`;
  await fs.writeTextFile(
    join(projectDir, "app", "api", "auth", config.name, "callback", "route.ts"),
    callbackRoute,
  );
  cliLogger.debug(`Created OAuth callback route`);
}

async function createApiKeyFiles(
  fs: FileSystem,
  baseDir: string,
  config: IntegrationConfig,
): Promise<void> {
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
  await fs.writeTextFile(join(baseDir, "lib", "token-store.ts"), tokenStore);
  cliLogger.debug(`Created ${join(baseDir, "lib", "token-store.ts")}`);
}

async function createClientFile(
  fs: FileSystem,
  baseDir: string,
  config: IntegrationConfig,
): Promise<void> {
  const authHeader = config.authType === "oauth2"
    ? `"Authorization": \`Bearer \${token}\``
    : `"Authorization": \`Bearer \${apiKey}\``;

  const tokenImport = config.authType === "oauth2"
    ? `import { getAccessToken } from "./token-store.ts";`
    : `import { requireApiKey } from "./token-store.ts";`;

  const tokenCheck = config.authType === "oauth2"
    ? `const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with ${config.displayName}. Please connect your account.");
  }`
    : `const apiKey = requireApiKey();`;

  const client = `

${tokenImport}

const API_BASE_URL = "${config.apiBaseUrl}";

interface ${config.displayName}Response<T> {
  data?: T;
  error?: string;
}

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

export async function getItem(id: string): Promise<unknown> {
  return ${config.name}Fetch<unknown>(\`/items/\${id}\`);
}

export async function createItem(data: Record<string, unknown>): Promise<unknown> {
  return ${config.name}Fetch<unknown>("/items", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function searchItems(query: string): Promise<unknown[]> {
  return ${config.name}Fetch<unknown[]>(\`/search?q=\${encodeURIComponent(query)}\`);
}
`;
  await fs.writeTextFile(join(baseDir, "lib", `${config.name}-client.ts`), client);
  cliLogger.debug(`Created API client`);
}

async function createToolSkeletons(
  fs: FileSystem,
  baseDir: string,
  config: IntegrationConfig,
): Promise<void> {
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
    const toolContent = `

import { tool } from "veryfront/ai";
import { z } from "zod";
import { listItems, getItem, searchItems } from "../lib/${config.name}-client.ts";

export default tool({
  id: "${tool.id}",
  description: "${tool.description}",
  inputSchema: z.object({
    ${
      tool.file === "list-items.ts"
        ? `limit: z.number().optional().describe("Maximum number of items to return"),
    offset: z.number().optional().describe("Number of items to skip"),`
        : ""
    }
    ${
      tool.file === "get-item.ts"
        ? `id: z.string().describe("The ID of the item to retrieve"),`
        : ""
    }
    ${tool.file === "search.ts" ? `query: z.string().describe("Search query"),` : ""}
  }),
  execute: async (input) => {
    try {
      ${
      tool.file === "list-items.ts"
        ? `const items = await listItems({
        limit: input.limit,
        offset: input.offset,
      });
      return {
        success: true,
        items,
        count: items.length,
      };`
        : ""
    }
      ${
      tool.file === "get-item.ts"
        ? `const item = await getItem(input.id);
      return {
        success: true,
        item,
      };`
        : ""
    }
      ${
      tool.file === "search.ts"
        ? `const results = await searchItems(input.query);
      return {
        success: true,
        results,
        count: results.length,
      };`
        : ""
    }
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

async function createEnvExample(
  fs: FileSystem,
  projectDir: string,
  config: IntegrationConfig,
): Promise<void> {
  const envExamplePath = join(projectDir, ".env.example");

  let envContent: string;
  if (config.authType === "oauth2") {
    envContent = `
# ${config.displayName} OAuth
${config.envVarPrefix}_CLIENT_ID=your_client_id
${config.envVarPrefix}_CLIENT_SECRET=your_client_secret
`;
  } else {
    envContent = `
# ${config.displayName} API
${config.envVarPrefix}_API_KEY=your_api_key
`;
  }

  try {
    const existing = await fs.readTextFile(envExamplePath);
    if (!existing.includes(config.envVarPrefix)) {
      await fs.writeTextFile(envExamplePath, existing + envContent);
      cliLogger.debug(`Updated .env.example`);
    }
  } catch {
    await fs.writeTextFile(envExamplePath, `# Environment Variables${envContent}`);
    cliLogger.debug(`Created .env.example`);
  }
}

async function ensureDir(fs: FileSystem, path: string): Promise<void> {
  try {
    await fs.mkdir(path, { recursive: true });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const isAlreadyExists = code === "EEXIST" ||
      (typeof Deno !== "undefined" && error instanceof Deno.errors.AlreadyExists);
    if (!isAlreadyExists) {
      throw error;
    }
  }
}
