export type TokenAuthMethod =
  | "basic"
  | "body"
  | "client_secret_basic"
  | "client_secret_post"
  | "request_body";

export interface IntegrationGeneratorOptionsLike {
  name?: string;
  displayName?: string;
  authType?: "oauth2" | "api-key";
  apiBaseUrl?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: string;
  tokenAuthMethod?: TokenAuthMethod;
  additionalAuthParams?: string;
  usePKCE?: boolean;
}

export interface IntegrationConfig {
  name: string;
  displayName: string;
  authType: "oauth2" | "api-key";
  apiBaseUrl: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes: string[];
  tokenAuthMethod: TokenAuthMethod;
  additionalAuthParams: Record<string, string>;
  usePKCE: boolean;
  envVarPrefix: string;
}

export function parseScopes(scopes?: string): string[] {
  return scopes?.split(",").map((scope) => scope.trim()) || [];
}

export function parseAdditionalAuthParams(params?: string): Record<string, string> {
  if (!params?.trim()) return {};

  return Object.fromEntries(
    params.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separatorIndex = entry.indexOf("=");
        if (separatorIndex === -1) {
          throw new Error(
            "Additional auth params must use key=value pairs separated by commas",
          );
        }

        const key = entry.slice(0, separatorIndex).trim();
        const value = entry.slice(separatorIndex + 1).trim();

        if (!key || !value) {
          throw new Error(
            "Additional auth params must use non-empty key=value pairs",
          );
        }

        return [key, value];
      }),
  );
}

export function normalizeTokenAuthMethod(method?: string): TokenAuthMethod {
  switch (method?.trim().toLowerCase()) {
    case "basic":
      return "basic";
    case "body":
      return "body";
    case "client_secret_basic":
      return "client_secret_basic";
    case "client_secret_post":
      return "client_secret_post";
    case "request_body":
    case undefined:
    case "":
      return "request_body";
    default:
      throw new Error(
        "OAuth token auth method must be one of: request_body, body, basic, client_secret_basic, client_secret_post",
      );
  }
}

export function parseBooleanOption(
  value: string | boolean | undefined,
  defaultValue = false,
): boolean {
  if (typeof value === "boolean") return value;
  if (!value?.trim()) return defaultValue;

  switch (value.trim().toLowerCase()) {
    case "y":
    case "yes":
    case "true":
    case "1":
      return true;
    case "n":
    case "no":
    case "false":
    case "0":
      return false;
    default:
      throw new Error("Boolean option must be yes/no, true/false, or 1/0");
  }
}

export function validateIntegrationName(name: string): void {
  if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error("Integration name must be lowercase letters, numbers, and hyphens");
  }
}

export function getNonInteractiveConfig(
  options: IntegrationGeneratorOptionsLike,
): IntegrationConfig {
  const { name, displayName, authType } = options;

  if (!name || !displayName || !authType) {
    throw new Error(
      "Non-interactive mode requires --name, --display-name, and --auth-type options",
    );
  }

  const normalizedName = name.toLowerCase();

  return {
    name: normalizedName,
    displayName,
    authType,
    apiBaseUrl: options.apiBaseUrl ?? `https://api.${name}.com`,
    authorizationUrl: options.authorizationUrl,
    tokenUrl: options.tokenUrl,
    scopes: parseScopes(options.scopes),
    tokenAuthMethod: normalizeTokenAuthMethod(options.tokenAuthMethod),
    additionalAuthParams: parseAdditionalAuthParams(options.additionalAuthParams),
    usePKCE: parseBooleanOption(options.usePKCE, false),
    envVarPrefix: name.toUpperCase().replace(/-/g, "_"),
  };
}

const TOOL_FILE_CONTENTS: Record<string, { inputSchema: string; executeBody: string }> = {
  "list-items.ts": {
    inputSchema: `limit: z.number().optional().describe("Maximum number of items to return"),
    offset: z.number().optional().describe("Number of items to skip"),`,
    executeBody: `const items = await listItems({
        limit: input.limit,
        offset: input.offset,
      });
      return {
        success: true,
        items,
        count: items.length,
      };`,
  },
  "get-item.ts": {
    inputSchema: `id: z.string().describe("The ID of the item to retrieve"),`,
    executeBody: `const item = await getItem(input.id);
      return {
        success: true,
        item,
      };`,
  },
  "search.ts": {
    inputSchema: `query: z.string().describe("Search query"),`,
    executeBody: `const results = await searchItems(input.query);
      return {
        success: true,
        results,
        count: results.length,
      };`,
  },
};

export function getToolInputSchema(toolFile: string): string {
  return TOOL_FILE_CONTENTS[toolFile]?.inputSchema ?? "";
}

export function getToolExecuteBody(toolFile: string): string {
  return TOOL_FILE_CONTENTS[toolFile]?.executeBody ?? "";
}
