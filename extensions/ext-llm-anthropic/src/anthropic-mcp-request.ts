type AnthropicMcpToolConfig = {
  enabled?: boolean;
  defer_loading?: boolean;
};

type AnthropicMcpToolset = {
  type: "mcp_toolset";
  mcp_server_name: string;
  default_config?: AnthropicMcpToolConfig;
  configs?: Record<string, AnthropicMcpToolConfig>;
  cache_control?: {
    type: "ephemeral";
    ttl?: "5m" | "1h";
  };
};

export type AnthropicMcpRequestConfiguration = {
  servers: Array<Record<string, unknown>>;
  defaultToolsets: AnthropicMcpToolset[];
  legacyConfiguredServerNames: ReadonlySet<string>;
};

const SERVER_INPUT_KEYS = new Set([
  "type",
  "url",
  "name",
  "authorizationToken",
  "authorization_token",
  "toolConfiguration",
  "tool_configuration",
]);
const LEGACY_TOOL_CONFIGURATION_KEYS = new Set([
  "enabled",
  "allowedTools",
  "allowed_tools",
]);
const SERVER_WIRE_KEYS = new Set([
  "type",
  "url",
  "name",
  "authorization_token",
]);
const TOOLSET_WIRE_KEYS = new Set([
  "type",
  "mcp_server_name",
  "default_config",
  "configs",
  "cache_control",
]);
const TOOL_CONFIG_KEYS = new Set(["enabled", "defer_loading"]);
const TOOLSET_INPUT_KEYS = new Set([
  "defaultConfig",
  "default_config",
  "configs",
  "cacheControl",
  "cache_control",
]);
const TOOL_CONFIG_INPUT_KEYS = new Set([
  "enabled",
  "deferLoading",
  "defer_loading",
]);
const CACHE_CONTROL_KEYS = new Set(["type", "ttl"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  message: string,
): void {
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new TypeError(message);
  }
}

function readAliasedValue(
  record: Record<string, unknown>,
  camelCaseKey: string,
  snakeCaseKey: string,
  message: string,
): unknown {
  const hasCamelCase = Object.hasOwn(record, camelCaseKey);
  const hasSnakeCase = Object.hasOwn(record, snakeCaseKey);
  if (hasCamelCase && hasSnakeCase) {
    throw new TypeError(message);
  }
  if (hasCamelCase) return record[camelCaseKey];
  if (hasSnakeCase) return record[snakeCaseKey];
  return undefined;
}

function requireNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(message);
  }
  return value;
}

function requireHttpsUrl(value: unknown): string {
  const url = requireNonEmptyString(value, "Anthropic MCP server url must be a non-empty string");
  try {
    if (!url.startsWith("https://") || new URL(url).protocol !== "https:") {
      throw new TypeError();
    }
  } catch {
    throw new TypeError("Anthropic MCP server url must be an absolute HTTPS URL");
  }
  return url;
}

function readLegacyToolConfiguration(
  raw: unknown,
): {
  defaultConfig?: AnthropicMcpToolConfig;
  configs?: Record<string, AnthropicMcpToolConfig>;
} {
  if (!isRecord(raw)) {
    throw new TypeError("Anthropic MCP toolConfiguration must be an object");
  }
  assertOnlyKeys(
    raw,
    LEGACY_TOOL_CONFIGURATION_KEYS,
    "Anthropic MCP toolConfiguration contains unsupported fields",
  );

  const enabled = raw.enabled;
  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw new TypeError("Anthropic MCP toolConfiguration.enabled must be a boolean");
  }

  const allowedTools = readAliasedValue(
    raw,
    "allowedTools",
    "allowed_tools",
    "Anthropic MCP toolConfiguration must not define both allowedTools spellings",
  );
  if (allowedTools === undefined) {
    return enabled === undefined ? {} : { defaultConfig: { enabled } };
  }
  if (
    !Array.isArray(allowedTools) ||
    allowedTools.some((name) => typeof name !== "string" || name.length === 0)
  ) {
    throw new TypeError(
      "Anthropic MCP toolConfiguration.allowedTools must be an array of non-empty strings",
    );
  }
  if (new Set(allowedTools).size !== allowedTools.length) {
    throw new TypeError("Anthropic MCP toolConfiguration.allowedTools must be unique");
  }
  if (enabled === false && allowedTools.length > 0) {
    throw new TypeError(
      "Anthropic MCP toolConfiguration cannot disable a server and enable individual tools",
    );
  }

  const configs = Object.fromEntries(
    allowedTools.map((name) => [name, { enabled: true }]),
  );
  return {
    defaultConfig: { enabled: false },
    ...(allowedTools.length > 0 ? { configs } : {}),
  };
}

/**
 * Validate and translate the existing camelCase MCP convenience option into
 * Anthropic's current MCP server and MCPToolset wire objects.
 */
export function normalizeAnthropicMcpServers(
  rawServers: unknown,
): AnthropicMcpRequestConfiguration | undefined {
  if (rawServers === undefined) return undefined;
  if (!Array.isArray(rawServers)) {
    throw new TypeError("Anthropic mcpServers must be an array");
  }
  if (rawServers.length === 0) return undefined;

  const servers: Array<Record<string, unknown>> = [];
  const defaultToolsets: AnthropicMcpToolset[] = [];
  const legacyConfiguredServerNames = new Set<string>();
  const seenServerNames = new Set<string>();

  for (const rawServer of rawServers) {
    if (!isRecord(rawServer)) {
      throw new TypeError("Anthropic mcpServers entries must be objects");
    }
    assertOnlyKeys(
      rawServer,
      SERVER_INPUT_KEYS,
      "Anthropic MCP server contains unsupported fields",
    );
    if (rawServer.type !== "url") {
      throw new TypeError('Anthropic MCP server type must be "url"');
    }

    const url = requireHttpsUrl(rawServer.url);
    const name = requireNonEmptyString(
      rawServer.name,
      "Anthropic MCP server name must be a non-empty string",
    );
    if (seenServerNames.has(name)) {
      throw new TypeError("Anthropic MCP server names must be unique");
    }
    seenServerNames.add(name);

    const authorizationToken = readAliasedValue(
      rawServer,
      "authorizationToken",
      "authorization_token",
      "Anthropic MCP server must not define both authorization token spellings",
    );
    if (
      authorizationToken !== undefined &&
      (typeof authorizationToken !== "string" || authorizationToken.length === 0)
    ) {
      throw new TypeError("Anthropic MCP server authorization token must be a non-empty string");
    }

    const toolConfiguration = readAliasedValue(
      rawServer,
      "toolConfiguration",
      "tool_configuration",
      "Anthropic MCP server must not define both toolConfiguration spellings",
    );
    const translatedToolConfiguration = toolConfiguration === undefined
      ? {}
      : readLegacyToolConfiguration(toolConfiguration);
    if (toolConfiguration !== undefined) {
      legacyConfiguredServerNames.add(name);
    }

    servers.push({
      type: "url",
      url,
      name,
      ...(authorizationToken !== undefined ? { authorization_token: authorizationToken } : {}),
    });
    defaultToolsets.push({
      type: "mcp_toolset",
      mcp_server_name: name,
      ...(translatedToolConfiguration.defaultConfig
        ? { default_config: translatedToolConfiguration.defaultConfig }
        : {}),
      ...(translatedToolConfiguration.configs
        ? { configs: translatedToolConfiguration.configs }
        : {}),
    });
  }

  return {
    servers,
    defaultToolsets,
    legacyConfiguredServerNames,
  };
}

function normalizeToolConfigInput(raw: unknown): AnthropicMcpToolConfig {
  if (!isRecord(raw)) {
    throw new TypeError("Anthropic MCP provider tool config must be an object");
  }
  assertOnlyKeys(
    raw,
    TOOL_CONFIG_INPUT_KEYS,
    "Anthropic MCP provider tool config contains unsupported fields",
  );
  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
    throw new TypeError("Anthropic MCP provider tool config enabled must be a boolean");
  }
  const deferLoading = readAliasedValue(
    raw,
    "deferLoading",
    "defer_loading",
    "Anthropic MCP provider tool config must not define both deferLoading spellings",
  );
  if (deferLoading !== undefined && typeof deferLoading !== "boolean") {
    throw new TypeError("Anthropic MCP provider tool config deferLoading must be a boolean");
  }
  return {
    ...(raw.enabled !== undefined ? { enabled: raw.enabled } : {}),
    ...(deferLoading !== undefined ? { defer_loading: deferLoading } : {}),
  };
}

/**
 * Convert generic provider-tool arguments without rewriting the dynamic tool
 * names used as keys in `configs`.
 */
export function normalizeAnthropicMcpToolsetArgs(
  rawArgs: Record<string, unknown>,
): Omit<AnthropicMcpToolset, "type" | "mcp_server_name"> {
  assertOnlyKeys(
    rawArgs,
    TOOLSET_INPUT_KEYS,
    "Anthropic MCP provider tool contains unsupported arguments",
  );
  const defaultConfig = readAliasedValue(
    rawArgs,
    "defaultConfig",
    "default_config",
    "Anthropic MCP provider tool must not define both defaultConfig spellings",
  );
  const cacheControl = readAliasedValue(
    rawArgs,
    "cacheControl",
    "cache_control",
    "Anthropic MCP provider tool must not define both cacheControl spellings",
  );

  let configs: Record<string, AnthropicMcpToolConfig> | undefined;
  if (rawArgs.configs !== undefined) {
    if (!isRecord(rawArgs.configs)) {
      throw new TypeError("Anthropic MCP provider tool configs must be an object");
    }
    const entries = Object.entries(rawArgs.configs);
    if (entries.some(([toolName]) => toolName.length === 0)) {
      throw new TypeError("Anthropic MCP provider tool config names must be non-empty");
    }
    configs = Object.fromEntries(
      entries.map(([toolName, config]) => [toolName, normalizeToolConfigInput(config)]),
    );
  }

  if (cacheControl !== undefined) {
    validateCacheControl(cacheControl);
  }
  const normalizedCacheControl = cacheControl as
    | { type: "ephemeral"; ttl?: "5m" | "1h" }
    | undefined;
  return {
    ...(defaultConfig !== undefined
      ? { default_config: normalizeToolConfigInput(defaultConfig) }
      : {}),
    ...(configs !== undefined ? { configs } : {}),
    ...(normalizedCacheControl !== undefined
      ? {
        cache_control: {
          type: normalizedCacheControl.type,
          ...(normalizedCacheControl.ttl !== undefined ? { ttl: normalizedCacheControl.ttl } : {}),
        },
      }
      : {}),
  };
}

function validateWireServer(rawServer: unknown): string {
  if (!isRecord(rawServer)) {
    throw new TypeError("Anthropic mcp_servers entries must be objects");
  }
  assertOnlyKeys(
    rawServer,
    SERVER_WIRE_KEYS,
    "Anthropic mcp_servers entry contains unsupported fields",
  );
  if (rawServer.type !== "url") {
    throw new TypeError('Anthropic mcp_servers entry type must be "url"');
  }
  requireHttpsUrl(rawServer.url);
  const name = requireNonEmptyString(
    rawServer.name,
    "Anthropic mcp_servers entry name must be a non-empty string",
  );
  if (
    rawServer.authorization_token !== undefined &&
    (typeof rawServer.authorization_token !== "string" ||
      rawServer.authorization_token.length === 0)
  ) {
    throw new TypeError(
      "Anthropic mcp_servers entry authorization_token must be a non-empty string",
    );
  }
  return name;
}

function validateToolConfig(raw: unknown, message: string): void {
  if (!isRecord(raw)) {
    throw new TypeError(message);
  }
  assertOnlyKeys(raw, TOOL_CONFIG_KEYS, message);
  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
    throw new TypeError(message);
  }
  if (raw.defer_loading !== undefined && typeof raw.defer_loading !== "boolean") {
    throw new TypeError(message);
  }
}

function validateCacheControl(raw: unknown): void {
  if (!isRecord(raw)) {
    throw new TypeError("Anthropic MCP toolset cache_control must be an object");
  }
  assertOnlyKeys(
    raw,
    CACHE_CONTROL_KEYS,
    "Anthropic MCP toolset cache_control contains unsupported fields",
  );
  if (raw.type !== "ephemeral") {
    throw new TypeError('Anthropic MCP toolset cache_control.type must be "ephemeral"');
  }
  if (raw.ttl !== undefined && raw.ttl !== "5m" && raw.ttl !== "1h") {
    throw new TypeError('Anthropic MCP toolset cache_control.ttl must be "5m" or "1h"');
  }
}

function validateMcpToolset(rawTool: Record<string, unknown>): string {
  assertOnlyKeys(
    rawTool,
    TOOLSET_WIRE_KEYS,
    "Anthropic MCP toolset contains unsupported fields",
  );
  const serverName = requireNonEmptyString(
    rawTool.mcp_server_name,
    "Anthropic MCP toolset mcp_server_name must be a non-empty string",
  );
  if (rawTool.default_config !== undefined) {
    validateToolConfig(
      rawTool.default_config,
      "Anthropic MCP toolset default_config must contain only boolean tool settings",
    );
  }
  if (rawTool.configs !== undefined) {
    if (!isRecord(rawTool.configs)) {
      throw new TypeError("Anthropic MCP toolset configs must be an object");
    }
    for (const [toolName, config] of Object.entries(rawTool.configs)) {
      if (toolName.length === 0) {
        throw new TypeError("Anthropic MCP toolset config names must be non-empty");
      }
      validateToolConfig(
        config,
        "Anthropic MCP toolset configs must contain only boolean tool settings",
      );
    }
  }
  if (rawTool.cache_control !== undefined) {
    validateCacheControl(rawTool.cache_control);
  }
  return serverName;
}

/**
 * Validate the final request after raw provider options have been merged.
 * Returns whether the current MCP connector beta is required.
 */
export function assertAnthropicMcpRequestContract(
  body: Record<string, unknown>,
): boolean {
  const rawServers = body.mcp_servers;
  const rawTools = body.tools;
  const mcpToolsets: Array<Record<string, unknown>> = [];

  if (rawTools !== undefined) {
    if (!Array.isArray(rawTools)) {
      if (rawServers !== undefined) {
        throw new TypeError("Anthropic MCP requests require tools to be an array");
      }
    } else {
      for (const rawTool of rawTools) {
        if (!isRecord(rawTool)) {
          if (rawServers !== undefined) {
            throw new TypeError("Anthropic MCP requests require tool entries to be objects");
          }
          continue;
        }
        if (rawTool.type === "mcp_toolset") {
          mcpToolsets.push(rawTool);
        }
      }
    }
  }

  if (rawServers === undefined) {
    if (mcpToolsets.length > 0) {
      throw new TypeError("Anthropic MCP toolsets require matching mcp_servers");
    }
    return false;
  }
  if (!Array.isArray(rawServers)) {
    throw new TypeError("Anthropic mcp_servers must be an array");
  }
  if (rawServers.length === 0) {
    if (mcpToolsets.length > 0) {
      throw new TypeError("Anthropic MCP toolsets require matching mcp_servers");
    }
    return false;
  }

  const serverNames = new Set<string>();
  for (const rawServer of rawServers) {
    const serverName = validateWireServer(rawServer);
    if (serverNames.has(serverName)) {
      throw new TypeError("Anthropic mcp_servers names must be unique");
    }
    serverNames.add(serverName);
  }

  const toolsetCountByServer = new Map<string, number>();
  for (const rawToolset of mcpToolsets) {
    const serverName = validateMcpToolset(rawToolset);
    if (!serverNames.has(serverName)) {
      throw new TypeError("Anthropic MCP toolset references an unknown server");
    }
    toolsetCountByServer.set(serverName, (toolsetCountByServer.get(serverName) ?? 0) + 1);
  }

  for (const serverName of serverNames) {
    if (toolsetCountByServer.get(serverName) !== 1) {
      throw new TypeError(
        "Anthropic MCP requests require exactly one mcp_toolset per server",
      );
    }
  }
  return true;
}
