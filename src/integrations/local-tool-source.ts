import { getEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import type { JsonSchema } from "#veryfront/extensions/schema/index.ts";
import { getEnv } from "#veryfront/platform/compat/process/env.ts";
import type {
  RemoteToolSource,
  ToolDefinition,
  ToolExecutionContext,
} from "#veryfront/tool/types.ts";
import { connectors } from "./_data.ts";
import {
  createLocalCredentialAuthPlan,
  type LocalCredentialAuthPlan,
  mintLocalCredentialAuth,
  resolveLocalCredentialAuth,
} from "./local-credential-auth.ts";
import {
  executeLocalIntegrationEndpoint,
  type LocalIntegrationEndpointTransport,
} from "./local-endpoint-executor.ts";
import { localIntegrationConfigurationError } from "./local-integration-errors.ts";
import { MAX_LOCAL_INTEGRATION_TOOLS } from "./limits.ts";
import { parseIntegrationToolIdentity } from "./source-policy.ts";
import type { IntegrationConfig, IntegrationToolMeta } from "./schema.ts";

/** Resolve one local integration credential by its canonical environment-variable name. */
export type LocalIntegrationCredentialProvider = (
  environmentVariableName: string,
) => string | undefined | Promise<string | undefined>;

/** Options for a catalog-backed local integration tool source. */
export interface LocalIntegrationToolSourceOptions {
  /** Exact canonical catalog tool IDs granted to this source. */
  tools: readonly string[];
  /** Defaults to the active project-scoped environment. */
  credentialProvider?: LocalIntegrationCredentialProvider;
}

type IntegrationEndpoint = NonNullable<IntegrationToolMeta["endpoint"]>;

interface AdmittedLocalIntegrationTool {
  readonly authPlan: LocalCredentialAuthPlan;
  readonly connector: IntegrationConfig;
  readonly endpoint: IntegrationEndpoint;
  readonly endpointOrigin?: string;
  readonly tool: IntegrationToolMeta & { id: string };
  readonly definition: ToolDefinition;
}

function configurationError(detail: string): never {
  return localIntegrationConfigurationError(detail);
}

function readOwnDataProperty(
  value: LocalIntegrationToolSourceOptions | readonly unknown[],
  key: PropertyKey,
): { present: boolean; value: unknown } {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return { present: false, value: undefined };
  if (!("value" in descriptor)) {
    configurationError(`Local integration option "${String(key)}" must be a data property`);
  }
  return { present: true, value: descriptor.value };
}

function snapshotOptions(options: LocalIntegrationToolSourceOptions): {
  tools: readonly string[];
  credentialProvider: LocalIntegrationCredentialProvider | undefined;
} {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    configurationError("Local integration options must be an object");
  }

  const toolsValue = readOwnDataProperty(options, "tools").value;
  if (!Array.isArray(toolsValue)) {
    configurationError("Local integration tools must be an array of canonical tool IDs");
  }
  if (toolsValue.length === 0) {
    configurationError("Local integration tools must include at least one canonical tool ID");
  }
  if (toolsValue.length > MAX_LOCAL_INTEGRATION_TOOLS) {
    configurationError(
      `Local integration tools exceed the ${MAX_LOCAL_INTEGRATION_TOOLS} tool limit`,
    );
  }

  const tools: string[] = [];
  for (let index = 0; index < toolsValue.length; index++) {
    const item = readOwnDataProperty(toolsValue, index);
    if (!item.present || typeof item.value !== "string") {
      configurationError("Local integration tools must contain only canonical string IDs");
    }
    tools.push(item.value);
  }

  const providerValue = readOwnDataProperty(options, "credentialProvider");
  if (
    providerValue.present && providerValue.value !== undefined &&
    typeof providerValue.value !== "function"
  ) {
    configurationError("Local integration credentialProvider must be a function");
  }

  return {
    tools: Object.freeze(tools),
    credentialProvider: providerValue.value as LocalIntegrationCredentialProvider | undefined,
  };
}

function declaredConnector(name: string): IntegrationConfig | undefined {
  for (let index = 0; index < connectors.length; index++) {
    const connector = connectors[index];
    if (connector?.name === name) return connector;
  }
  return undefined;
}

function catalogTool(
  connector: IntegrationConfig,
  canonicalToolId: string,
): (IntegrationToolMeta & { id: string }) | undefined {
  for (let index = 0; index < connector.tools.length; index++) {
    const tool = connector.tools[index];
    const catalogId = tool?.id ?? tool?.name;
    if (
      catalogId === canonicalToolId ||
      (catalogId !== undefined && `${connector.name}__${catalogId}` === canonicalToolId)
    ) {
      if (typeof tool?.name !== "string" || typeof tool.description !== "string") {
        configurationError(`Local integration tool "${canonicalToolId}" has invalid metadata`);
      }
      return Object.freeze({
        ...tool,
        id: canonicalToolId,
        name: tool.name,
        description: tool.description,
      });
    }
  }
  return undefined;
}

function assertHttpsCatalogUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    configurationError(`${label} must be a fixed HTTPS URL`);
  }
  if (
    parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" ||
    value.includes("{{") || parsed.hostname.includes("{") || parsed.hostname.includes("}")
  ) {
    configurationError(`${label} must be a fixed HTTPS URL without credentials`);
  }
  return parsed.origin;
}

function assertSupportedAuth(
  connector: IntegrationConfig,
  endpoint: IntegrationEndpoint,
): void {
  const auth = connector.auth;
  if (connector.name === "salesforce") return;

  if (auth.type === "api-key") {
    if (auth.queryParamName || endpoint.url.includes("{{auth.token}}")) {
      configurationError(
        `Local integration "${connector.name}" uses query or URL credentials, ` +
          "which are unsupported",
      );
    }
    if (!auth.keyName) {
      configurationError(`Local integration "${connector.name}" is missing its API-key name`);
    }
    return;
  }

  if (auth.type === "basic") {
    if (!auth.usernameKey || !auth.passwordKey) {
      configurationError(`Local integration "${connector.name}" is missing Basic credential names`);
    }
    return;
  }

  if (auth.type === "oauth2" && auth.grantType === "client_credentials") {
    if (!auth.tokenUrl) {
      configurationError(`Local integration "${connector.name}" is missing its token URL`);
    }
    assertHttpsCatalogUrl(auth.tokenUrl, `Local integration "${connector.name}" token URL`);
    return;
  }

  configurationError(
    `Local integration "${connector.name}" uses unsupported authorization-code credentials`,
  );
}

function assertSupportedEndpoint(
  connector: IntegrationConfig,
  endpoint: IntegrationEndpoint,
  toolId: string,
): string | undefined {
  if (endpoint.type === "graphql") {
    configurationError(`Local integration tool "${toolId}" uses unsupported GraphQL execution`);
  }
  if (endpoint.response?.enrich) {
    configurationError(`Local integration tool "${toolId}" uses unsupported response enrichment`);
  }
  if (endpoint.bodyMode === "form-data" || endpoint.bodyMode === "raw") {
    configurationError(`Local integration tool "${toolId}" uses an unsupported body mode`);
  }
  for (const field of Object.values(endpoint.body ?? {})) {
    if (field.encoding || field.partFilenameField) {
      configurationError(`Local integration tool "${toolId}" uses an unsupported encoded body`);
    }
  }

  if (connector.name === "salesforce") {
    if (!endpoint.url.startsWith("{{oauth.raw.instance_url}}/")) {
      configurationError(`Local Salesforce tool "${toolId}" has an unsupported endpoint template`);
    }
    return undefined;
  } else {
    return assertHttpsCatalogUrl(
      endpoint.url,
      `Local integration tool "${toolId}" endpoint`,
    );
  }
}

function inputPropertySchema(
  field: {
    type: string;
    description: string;
    default?: unknown;
    exposeDefault?: boolean;
  },
): JsonSchema {
  if (
    field.type !== "string" && field.type !== "number" && field.type !== "boolean" &&
    field.type !== "string[]" && field.type !== "object" && field.type !== "array"
  ) {
    configurationError(`Local integration input uses unsupported type "${field.type}"`);
  }
  const schema: Record<string, unknown> = {
    type: field.type === "string[]" ? "array" : field.type,
    description: field.description,
  };
  if (field.type === "string[]") schema.items = { type: "string" };
  if (field.exposeDefault === true && field.default !== undefined) {
    schema.default = field.default;
  }
  return schema as JsonSchema;
}

function toolDefinition(
  tool: IntegrationToolMeta & { id: string },
  endpoint: IntegrationEndpoint,
): ToolDefinition {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const [name, parameter] of Object.entries(endpoint.params ?? {})) {
    properties[name] = inputPropertySchema(parameter);
    if (parameter.required) required.push(name);
  }
  for (const [name, field] of Object.entries(endpoint.body ?? {})) {
    if (properties[name]) {
      configurationError(`Local integration tool "${tool.id}" declares duplicate input "${name}"`);
    }
    properties[name] = inputPropertySchema(field);
    if (field.required) required.push(name);
  }

  return Object.freeze({
    name: tool.id,
    description: tool.description,
    parameters: Object.freeze({
      type: "object",
      properties: Object.freeze(properties),
      required: Object.freeze(required),
      additionalProperties: false,
    }) as JsonSchema,
  });
}

function admitTool(canonicalToolId: string): AdmittedLocalIntegrationTool {
  const identity = parseIntegrationToolIdentity(canonicalToolId);
  if (!identity) {
    configurationError(`Local integration tool "${canonicalToolId}" must use a canonical ID`);
  }

  const connector = declaredConnector(identity.integration);
  if (!connector) {
    configurationError(`Local integration tool "${canonicalToolId}" names an unknown connector`);
  }
  const tool = catalogTool(connector, canonicalToolId);
  if (!tool) {
    configurationError(`Local integration tool "${canonicalToolId}" is unknown`);
  }
  if (!tool.endpoint) {
    configurationError(`Local integration tool "${canonicalToolId}" has no executable endpoint`);
  }

  const endpointOrigin = assertSupportedEndpoint(
    connector,
    tool.endpoint,
    canonicalToolId,
  );
  assertSupportedAuth(connector, tool.endpoint);
  return Object.freeze({
    authPlan: createLocalCredentialAuthPlan(connector),
    connector,
    endpoint: tool.endpoint,
    endpointOrigin,
    tool,
    definition: toolDefinition(tool, tool.endpoint),
  });
}

function assertLocalRuntime(): void {
  const environment = getEnvironmentConfig();
  if (environment.proxyMode || environment.veryfrontMode === "hosted") {
    configurationError(
      "Local integration credentials are available only in local or self-hosted runtimes",
    );
  }
}

function createLocalIntegrationToolSourceInternal(
  options: LocalIntegrationToolSourceOptions,
  transport?: LocalIntegrationEndpointTransport,
): RemoteToolSource {
  const snapshot = snapshotOptions(options);
  const admitted = new Map<string, AdmittedLocalIntegrationTool>();
  const credentialProvider = snapshot.credentialProvider ?? getEnv;

  for (const toolId of snapshot.tools) {
    if (admitted.has(toolId)) {
      configurationError(`Local integration tool "${toolId}" is a duplicate grant`);
    }
    admitted.set(toolId, admitTool(toolId));
  }

  return Object.freeze({
    id: "veryfront-local-integrations",
    async listTools(): Promise<ToolDefinition[]> {
      assertLocalRuntime();
      const validatedConnectors = new Set<string>();
      for (const toolId of snapshot.tools) {
        const tool = admitted.get(toolId)!;
        if (validatedConnectors.has(tool.connector.name)) continue;
        await resolveLocalCredentialAuth(tool.authPlan, credentialProvider);
        validatedConnectors.add(tool.connector.name);
      }
      return snapshot.tools.map((toolId) => admitted.get(toolId)!.definition);
    },
    async executeTool(
      toolName: string,
      args: Record<string, unknown>,
      context?: ToolExecutionContext,
    ): Promise<unknown> {
      assertLocalRuntime();
      const tool = admitted.get(toolName);
      if (!tool) {
        configurationError(`Local integration tool "${toolName}" is not granted by this source`);
      }
      const auth = await mintLocalCredentialAuth(
        await resolveLocalCredentialAuth(tool.authPlan, credentialProvider),
        context?.abortSignal,
        transport,
      );
      let endpoint = tool.endpoint;
      let allowedOrigin = tool.endpointOrigin;
      if (tool.connector.name === "salesforce") {
        if (!auth.instanceOrigin) {
          configurationError("Local Salesforce execution requires a validated instance origin");
        }
        endpoint = Object.freeze({
          ...endpoint,
          url: endpoint.url.replace(
            "{{oauth.raw.instance_url}}",
            auth.instanceOrigin,
          ),
        });
        allowedOrigin = auth.instanceOrigin;
      }
      if (!allowedOrigin) {
        configurationError(`Local integration tool "${toolName}" has no admitted origin`);
      }
      return await executeLocalIntegrationEndpoint({
        endpoint,
        args,
        authHeaders: auth.headers,
        allowedOrigin,
        signal: context?.abortSignal,
        transport,
      });
    },
  });
}

/** Create an explicitly granted, catalog-backed local integration tool source. */
export function createLocalIntegrationToolSource(
  options: LocalIntegrationToolSourceOptions,
): RemoteToolSource {
  return createLocalIntegrationToolSourceInternal(options);
}

/** @internal Test-only transport seam; not exported from the public integrations module. */
export function _createLocalIntegrationToolSourceForTesting(
  options: LocalIntegrationToolSourceOptions,
  transport: LocalIntegrationEndpointTransport,
): RemoteToolSource {
  return createLocalIntegrationToolSourceInternal(options, transport);
}
