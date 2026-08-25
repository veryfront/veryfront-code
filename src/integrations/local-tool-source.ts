import type { JsonSchema } from "#veryfront/extensions/schema/index.ts";
import { getEnv } from "#veryfront/platform/compat/process/env.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import type {
  RemoteToolSource,
  ToolDefinition,
  ToolExecutionContext,
} from "#veryfront/tool/types.ts";
import { connectors } from "#veryfront/integrations/_data.ts";
import {
  createLocalCredentialAuthPlan,
  type LocalCredentialAuthPlan,
  mintLocalCredentialAuth,
  resolveLocalCredentialAuth,
} from "#veryfront/integrations/local-credential-auth.ts";
import {
  executeLocalIntegrationEndpoint,
  type LocalIntegrationEndpointTransport,
  snapshotLocalIntegrationEndpointArguments,
} from "#veryfront/integrations/local-endpoint-executor.ts";
import {
  localIntegrationConfigurationError,
  safeLocalIntegrationIdentifier,
} from "#veryfront/integrations/local-integration-errors.ts";
import { guardLocalCredentialSource } from "#veryfront/integrations/local-credential-host-policy.ts";
import { MAX_LOCAL_INTEGRATION_TOOLS } from "#veryfront/integrations/limits.ts";
import { parseIntegrationToolIdentity } from "#veryfront/integrations/source-policy.ts";
import type { IntegrationConfig, IntegrationToolMeta } from "#veryfront/integrations/schema.ts";

const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const abortSignalThrowIfAborted = AbortSignal.prototype.throwIfAborted;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const MapConstructor = Map;
const mapGet = Map.prototype.get;
const mapHas = Map.prototype.has;
const mapSet = Map.prototype.set;
const objectDefineProperty = Object.defineProperty;
const objectEntries = Object.entries;
const objectValues = Object.values;
const SetConstructor = Set;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const stringIncludes = String.prototype.includes;
const stringIndexOf = String.prototype.indexOf;
const stringReplace = String.prototype.replace;
const stringReplaceAll = String.prototype.replaceAll;
const stringSlice = String.prototype.slice;
const stringStartsWith = String.prototype.startsWith;
const URLConstructor = URL;
const urlHash = Object.getOwnPropertyDescriptor(URL.prototype, "hash")?.get;
const urlHostname = Object.getOwnPropertyDescriptor(URL.prototype, "hostname")?.get;
const urlOrigin = Object.getOwnPropertyDescriptor(URL.prototype, "origin")?.get;
const urlPassword = Object.getOwnPropertyDescriptor(URL.prototype, "password")?.get;
const urlProtocol = Object.getOwnPropertyDescriptor(URL.prototype, "protocol")?.get;
const urlUsername = Object.getOwnPropertyDescriptor(URL.prototype, "username")?.get;

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

interface EnumeratedHostBinding {
  readonly token: string;
  readonly parameterName: string;
  readonly origins: Map<string, string>;
}

interface AdmittedLocalIntegrationTool {
  readonly authPlan: LocalCredentialAuthPlan;
  readonly connector: LocalCatalogConnector;
  readonly endpoint: IntegrationEndpoint;
  readonly endpointOrigin?: string;
  readonly enumeratedHost?: EnumeratedHostBinding;
  readonly tool: IntegrationToolMeta & { id: string };
  readonly definition: ToolDefinition;
}

type LocalCatalogConnector = Pick<IntegrationConfig, "auth" | "envVars" | "name">;

interface LocalCatalogTool {
  readonly connector: LocalCatalogConnector;
  readonly tool: IntegrationToolMeta & { readonly id: string };
}

function append<T>(values: T[], value: T): void {
  objectDefineProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function stringBoolean(
  operation: (this: string, search: string) => boolean,
  value: string,
  search: string,
): boolean {
  return apply(operation, value, [search]);
}

function removeCredentialNames(value: string, credentialNames: readonly string[]): string {
  let sanitized = value;
  for (let index = 0; index < credentialNames.length; index++) {
    const name = credentialNames[index]!;
    if (name.length === 0) {
      configurationError("Local integration credential names must not be empty");
    }
    sanitized = apply(stringReplaceAll, sanitized, [name, "configured credential"]);
  }
  return sanitized;
}

function containsCredentialName(value: unknown, credentialNames: readonly string[]): boolean {
  if (typeof value === "string") {
    for (let index = 0; index < credentialNames.length; index++) {
      if (stringBoolean(stringIncludes, value, credentialNames[index]!)) return true;
    }
    return false;
  }
  if (value === null || typeof value !== "object") return false;

  const entries = objectEntries(value);
  for (let index = 0; index < entries.length; index++) {
    const [key, entryValue] = entries[index]!;
    if (
      containsCredentialName(key, credentialNames) ||
      containsCredentialName(entryValue, credentialNames)
    ) {
      return true;
    }
  }
  return false;
}

function urlValue(getter: ((this: URL) => string) | undefined, url: URL): string {
  if (!getter) configurationError("URL parsing is unavailable in this runtime");
  return apply(getter, url, []);
}

function mapValue<K, V>(map: Map<K, V>, key: K): V | undefined {
  return apply(mapGet, map, [key]) as V | undefined;
}

function throwIfCallerAborted(signal: AbortSignal | undefined): void {
  if (!signal) return;
  if (typeof abortSignalThrowIfAborted !== "function") {
    configurationError("AbortSignal cancellation is unavailable in this runtime");
  }
  apply(abortSignalThrowIfAborted, signal, []);
}

function configurationError(detail: string): never {
  return localIntegrationConfigurationError(detail);
}

function readOwnDataProperty(
  value: LocalIntegrationToolSourceOptions | readonly unknown[],
  key: PropertyKey,
): { present: boolean; value: unknown } {
  const descriptor = getOwnPropertyDescriptor(value, key);
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
  if (typeof options !== "object" || options === null || arrayIsArray(options)) {
    configurationError("Local integration options must be an object");
  }

  const toolsValue = readOwnDataProperty(options, "tools").value;
  if (!arrayIsArray(toolsValue)) {
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
    append(tools, item.value);
  }

  const providerValue = readOwnDataProperty(options, "credentialProvider");
  if (
    providerValue.present && providerValue.value !== undefined &&
    typeof providerValue.value !== "function"
  ) {
    configurationError("Local integration credentialProvider must be a function");
  }

  return {
    tools: freeze(tools),
    credentialProvider: providerValue.value as LocalIntegrationCredentialProvider | undefined,
  };
}

function catalogSnapshot<T>(value: unknown, label: string): T {
  const snapshot = snapshotBoundedJsonValue(value);
  if (!snapshot.success) {
    configurationError(`Local integration catalog ${label} is not data-only JSON`);
  }
  return snapshot.value as T;
}

function captureLocalCatalog(): Map<string, LocalCatalogTool> {
  const captured = new MapConstructor<string, LocalCatalogTool>();
  for (let connectorIndex = 0; connectorIndex < connectors.length; connectorIndex++) {
    const connector = connectors[connectorIndex];
    if (!connector || typeof connector.name !== "string") continue;
    const connectorSnapshot = freeze({
      name: connector.name,
      auth: catalogSnapshot<IntegrationConfig["auth"]>(
        connector.auth,
        `authentication for "${connector.name}"`,
      ),
      envVars: catalogSnapshot<IntegrationConfig["envVars"]>(
        connector.envVars ?? [],
        `environment variables for "${connector.name}"`,
      ),
    });

    for (let toolIndex = 0; toolIndex < connector.tools.length; toolIndex++) {
      const tool = connector.tools[toolIndex];
      const catalogId = tool?.id ?? tool?.name;
      if (typeof catalogId !== "string") continue;
      const canonicalToolId = stringBoolean(stringIncludes, catalogId, "__")
        ? catalogId
        : `${connector.name}__${catalogId}`;
      if (typeof tool?.name !== "string" || typeof tool.description !== "string") {
        configurationError(`Local integration tool "${canonicalToolId}" has invalid metadata`);
      }
      const toolSnapshot = catalogSnapshot<IntegrationToolMeta & { readonly id: string }>({
        ...tool,
        id: canonicalToolId,
        name: tool.name,
        description: tool.description,
      }, `tool "${canonicalToolId}"`);
      apply(mapSet, captured, [
        canonicalToolId,
        freeze({
          connector: connectorSnapshot,
          tool: toolSnapshot,
        }),
      ]);
    }
  }
  return captured;
}

/**
 * Captured on first use rather than at module load: the integrations barrel
 * statically re-exports this module, so an invalid catalog entry at module
 * evaluation would prevent the whole barrel from importing even when no local
 * source is ever created.
 */
let localCatalog: Map<string, LocalCatalogTool> | undefined;

function getLocalCatalog(): Map<string, LocalCatalogTool> {
  localCatalog ??= captureLocalCatalog();
  return localCatalog;
}

function assertHttpsCatalogUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URLConstructor(value);
  } catch {
    configurationError(`${label} must be a fixed HTTPS URL`);
  }
  if (
    urlValue(urlProtocol, parsed) !== "https:" || urlValue(urlUsername, parsed) !== "" ||
    urlValue(urlPassword, parsed) !== "" || urlValue(urlHash, parsed) !== "" ||
    stringBoolean(stringIncludes, value, "{{") ||
    stringBoolean(stringIncludes, urlValue(urlHostname, parsed), "{") ||
    stringBoolean(stringIncludes, urlValue(urlHostname, parsed), "}")
  ) {
    configurationError(`${label} must be a fixed HTTPS URL without credentials`);
  }
  return urlValue(urlOrigin, parsed);
}

function enumeratedHostBinding(
  endpoint: IntegrationEndpoint,
  toolId: string,
): EnumeratedHostBinding | undefined {
  const schemePrefix = "https://";
  if (!stringBoolean(stringStartsWith, endpoint.url, schemePrefix)) return undefined;
  const pathStart = apply(stringIndexOf, endpoint.url, ["/", schemePrefix.length]) as number;
  const authorityEnd = pathStart === -1 ? endpoint.url.length : pathStart;
  const tokenStart = apply(stringIndexOf, endpoint.url, ["{", schemePrefix.length]) as number;
  if (tokenStart === -1 || tokenStart >= authorityEnd) return undefined;
  const tokenEnd = apply(stringIndexOf, endpoint.url, ["}", tokenStart + 1]) as number;
  if (tokenEnd === -1 || tokenEnd >= authorityEnd) return undefined;

  const parameterName = apply(stringSlice, endpoint.url, [tokenStart + 1, tokenEnd]) as string;
  const token = `{${parameterName}}`;
  const parameter = endpoint.params?.[parameterName];
  if (
    !parameter || parameter.in !== "path" || parameter.type !== "string" ||
    !arrayIsArray(parameter.enum) || parameter.enum.length === 0
  ) {
    configurationError(
      `Local integration tool "${toolId}" endpoint must be a fixed HTTPS URL ` +
        "or restrict its host to an enum",
    );
  }

  const origins = new MapConstructor<string, string>();
  for (let index = 0; index < parameter.enum.length; index++) {
    const host = parameter.enum[index];
    if (typeof host !== "string" || host.length === 0) {
      configurationError(`Local integration tool "${toolId}" has an invalid host enum`);
    }
    const resolvedUrl = apply(stringReplace, endpoint.url, [token, host]) as string;
    apply(mapSet, origins, [
      host,
      assertHttpsCatalogUrl(resolvedUrl, `Local integration tool "${toolId}" endpoint`),
    ]);
  }
  if (
    parameter.default !== undefined &&
    (typeof parameter.default !== "string" || !apply(mapHas, origins, [parameter.default]))
  ) {
    configurationError(`Local integration tool "${toolId}" has an invalid default host`);
  }
  return freeze({ token, parameterName, origins });
}

function assertSupportedAuth(
  connector: LocalCatalogConnector,
  endpoint: IntegrationEndpoint,
): void {
  const auth = connector.auth;
  if (connector.name === "salesforce") return;

  if (auth.type === "api-key") {
    if (
      auth.queryParamName ||
      stringBoolean(stringIncludes, endpoint.url, "{{auth.token}}")
    ) {
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
  connector: LocalCatalogConnector,
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
  const bodyFields = objectValues(endpoint.body ?? {});
  for (let index = 0; index < bodyFields.length; index++) {
    const field = bodyFields[index]!;
    if (field.encoding || field.partFilenameField) {
      configurationError(`Local integration tool "${toolId}" uses an unsupported encoded body`);
    }
  }

  if (connector.name === "salesforce") {
    if (!stringBoolean(stringStartsWith, endpoint.url, "{{oauth.raw.instance_url}}/")) {
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
    enum?: string[];
    exposeDefault?: boolean;
  },
  credentialNames: readonly string[],
): JsonSchema {
  if (
    field.type !== "string" && field.type !== "number" && field.type !== "boolean" &&
    field.type !== "string[]" && field.type !== "object" && field.type !== "array"
  ) {
    configurationError(`Local integration input uses unsupported type "${field.type}"`);
  }
  const schema: Record<string, unknown> = {
    type: field.type === "string[]" ? "array" : field.type,
    description: removeCredentialNames(field.description, credentialNames),
  };
  if (field.type === "string[]") schema.items = { type: "string" };
  if (field.enum !== undefined) {
    if (field.type !== "string" || field.enum.length === 0) {
      configurationError("Local integration enums require a non-empty string allowlist");
    }
    const allowedValues: string[] = [];
    for (let index = 0; index < field.enum.length; index++) {
      append(allowedValues, field.enum[index]!);
    }
    schema.enum = freeze(allowedValues);
  }
  if (field.exposeDefault === true && field.default !== undefined) {
    schema.default = field.default;
  }
  return schema as JsonSchema;
}

function toolDefinition(
  tool: IntegrationToolMeta & { id: string },
  endpoint: IntegrationEndpoint,
  credentialNames: readonly string[],
): ToolDefinition {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  const parameterEntries = objectEntries(endpoint.params ?? {});
  for (let index = 0; index < parameterEntries.length; index++) {
    const [name, parameter] = parameterEntries[index]!;
    properties[name] = inputPropertySchema(parameter, credentialNames);
    if (parameter.required) append(required, name);
  }
  const bodyEntries = objectEntries(endpoint.body ?? {});
  for (let index = 0; index < bodyEntries.length; index++) {
    const [name, field] = bodyEntries[index]!;
    if (properties[name]) {
      configurationError(`Local integration tool "${tool.id}" declares duplicate input "${name}"`);
    }
    properties[name] = inputPropertySchema(field, credentialNames);
    if (field.required) append(required, name);
  }

  const definition = freeze({
    name: tool.id,
    description: removeCredentialNames(tool.description, credentialNames),
    parameters: freeze({
      type: "object",
      properties: freeze(properties),
      required: freeze(required),
      additionalProperties: false,
    }) as JsonSchema,
  });
  if (containsCredentialName(definition, credentialNames)) {
    configurationError(
      `Local integration tool "${tool.id}" exposes a credential name outside descriptions`,
    );
  }
  return definition;
}

function admitTool(canonicalToolId: string): AdmittedLocalIntegrationTool {
  const identity = parseIntegrationToolIdentity(canonicalToolId);
  if (!identity) {
    configurationError(`Local integration tool "${canonicalToolId}" must use a canonical ID`);
  }

  const catalogEntry = mapValue(getLocalCatalog(), canonicalToolId);
  if (!catalogEntry) {
    let knownConnector = false;
    for (let index = 0; index < connectors.length; index++) {
      if (connectors[index]?.name === identity.integration) knownConnector = true;
    }
    if (!knownConnector) {
      configurationError(`Local integration tool "${canonicalToolId}" names an unknown connector`);
    }
    configurationError(`Local integration tool "${canonicalToolId}" is unknown`);
  }
  const { connector, tool } = catalogEntry;
  if (!tool.endpoint) {
    configurationError(`Local integration tool "${canonicalToolId}" has no executable endpoint`);
  }

  const enumeratedHost = enumeratedHostBinding(tool.endpoint, canonicalToolId);
  const endpointOrigin = enumeratedHost
    ? undefined
    : assertSupportedEndpoint(connector, tool.endpoint, canonicalToolId);
  assertSupportedAuth(connector, tool.endpoint);
  const authPlan = createLocalCredentialAuthPlan(connector);
  return freeze({
    authPlan,
    connector,
    endpoint: tool.endpoint,
    endpointOrigin,
    enumeratedHost,
    tool,
    definition: toolDefinition(
      tool,
      tool.endpoint,
      authPlan.requiredEnvironmentVariables,
    ),
  });
}

function createLocalIntegrationToolSourceInternal(
  options: LocalIntegrationToolSourceOptions,
  transport?: LocalIntegrationEndpointTransport,
): RemoteToolSource {
  const snapshot = snapshotOptions(options);
  const admitted = new MapConstructor<string, AdmittedLocalIntegrationTool>();
  const credentialProvider = snapshot.credentialProvider ?? getEnv;

  for (let index = 0; index < snapshot.tools.length; index++) {
    const toolId = snapshot.tools[index]!;
    if (apply(mapHas, admitted, [toolId])) {
      configurationError(`Local integration tool "${toolId}" is a duplicate grant`);
    }
    apply(mapSet, admitted, [toolId, admitTool(toolId)]);
  }

  return guardLocalCredentialSource(freeze({
    id: "veryfront-local-integrations",
    async listTools(): Promise<ToolDefinition[]> {
      const validatedConnectors = new SetConstructor<string>();
      for (let index = 0; index < snapshot.tools.length; index++) {
        const toolId = snapshot.tools[index]!;
        const tool = mapValue(admitted, toolId)!;
        if (apply(setHas, validatedConnectors, [tool.connector.name])) continue;
        await resolveLocalCredentialAuth(tool.authPlan, credentialProvider);
        apply(setAdd, validatedConnectors, [tool.connector.name]);
      }
      const definitions: ToolDefinition[] = [];
      for (let index = 0; index < snapshot.tools.length; index++) {
        append(definitions, mapValue(admitted, snapshot.tools[index]!)!.definition);
      }
      return definitions;
    },
    async executeTool(
      toolName: string,
      args: Record<string, unknown>,
      context?: ToolExecutionContext,
    ): Promise<unknown> {
      throwIfCallerAborted(context?.abortSignal);
      const tool = mapValue(admitted, toolName);
      if (!tool) {
        configurationError(
          `Local integration tool "${
            safeLocalIntegrationIdentifier(toolName)
          }" is not granted by this source`,
        );
      }
      const validated = snapshotLocalIntegrationEndpointArguments(tool.endpoint, args);
      let endpoint = tool.endpoint;
      let allowedOrigin = tool.endpointOrigin;
      if (tool.enumeratedHost) {
        const host = validated.args[tool.enumeratedHost.parameterName];
        if (typeof host !== "string") {
          configurationError(`Local integration tool "${toolName}" has no allowed host`);
        }
        allowedOrigin = mapValue(tool.enumeratedHost.origins, host);
        if (!allowedOrigin) {
          configurationError(`Local integration tool "${toolName}" has no allowed host`);
        }
        endpoint = freeze({
          ...endpoint,
          url: apply(stringReplace, endpoint.url, [tool.enumeratedHost.token, host]) as string,
        });
      }
      const auth = await mintLocalCredentialAuth(
        await resolveLocalCredentialAuth(tool.authPlan, credentialProvider),
        toolName,
        context?.abortSignal,
        transport,
      );
      if (tool.connector.name === "salesforce") {
        if (!auth.instanceOrigin) {
          configurationError("Local Salesforce execution requires a validated instance origin");
        }
        endpoint = freeze({
          ...endpoint,
          url: apply(stringReplace, endpoint.url, [
            "{{oauth.raw.instance_url}}",
            auth.instanceOrigin,
          ]) as string,
        });
        allowedOrigin = auth.instanceOrigin;
      }
      if (!allowedOrigin) {
        configurationError(`Local integration tool "${toolName}" has no admitted origin`);
      }
      return await executeLocalIntegrationEndpoint({
        connectorName: tool.connector.name,
        toolId: toolName,
        endpoint,
        args: validated.args,
        // Serialized before the credential step below; re-serializing after it
        // could send a body that was never bound-checked.
        body: validated.body,
        authHeaders: auth.headers,
        allowedOrigin,
        signal: context?.abortSignal,
        transport,
      });
    },
  }));
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
