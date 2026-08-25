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
  LOCAL_INTEGRATION_CREDENTIALS_MISSING,
  LOCAL_INTEGRATION_REQUEST_INVALID,
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
const stringCharCodeAt = String.prototype.charCodeAt;
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

interface AdmittedLocalIntegrationTool {
  readonly authPlan: LocalCredentialAuthPlan;
  readonly connector: LocalCatalogConnector;
  readonly endpoint: IntegrationEndpoint;
  readonly endpointOrigin?: string;
  readonly environmentHost?: EnvironmentHostBinding;
  readonly tenantHost?: TenantHostBinding;
  readonly tool: IntegrationToolMeta & { id: string };
  readonly definition: ToolDefinition;
}

/**
 * A catalog endpoint whose leading host label is selected by one required tool
 * argument while the registrable domain stays fixed in the catalog template
 * (for example `https://{indexHostPrefix}.pinecone.io/query`). The argument
 * may only extend the fixed provider-owned domain with subdomain labels, so a
 * caller can route between tenants of that provider but can never redirect the
 * connector's credentials to another registrable domain.
 */
interface TenantHostBinding {
  /** The `{name}` placeholder as it appears in the endpoint URL authority. */
  readonly token: string;
  /** The required path parameter that supplies the tenant subdomain labels. */
  readonly parameterName: string;
}

/** A catalog endpoint host bound to a configured environment variable. */
interface EnvironmentHostBinding {
  /** The `{{env.NAME}}` token as it appears in the endpoint URL. */
  readonly token: string;
  /** The environment variable that supplies the host. */
  readonly variableName: string;
  /** Catalog-declared fallback host used when the variable is unset. */
  readonly defaultValue: string | undefined;
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

const ENVIRONMENT_HOST_PREFIX = "{{env.";
/**
 * Syntactically valid but unroutable (`.invalid` TLD) stand-in host used to
 * validate an environment-host URL template before the variable is resolved.
 */
const ENVIRONMENT_HOST_PROBE = "environment-host-probe.invalid";

function isEnvironmentVariableName(value: string): boolean {
  if (value.length === 0 || value.length > 100) return false;
  for (let index = 0; index < value.length; index++) {
    const code = apply(stringCharCodeAt, value, [index]) as number;
    const allowed = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || code === 95;
    if (!allowed) return false;
  }
  return true;
}

/**
 * Accepts only a bare hostname with an optional numeric port. Anything that
 * could break out of the URL authority once substituted — a scheme, userinfo,
 * a path separator, a query, or whitespace — is rejected before the value
 * reaches the endpoint template.
 */
function isHostWithOptionalPort(value: string): boolean {
  if (value.length === 0 || value.length > 255) return false;
  let sawColon = false;
  let portDigits = 0;
  for (let index = 0; index < value.length; index++) {
    const code = apply(stringCharCodeAt, value, [index]) as number;
    if (code === 58) {
      if (sawColon || index === 0) return false;
      sawColon = true;
      continue;
    }
    if (sawColon) {
      if (code < 48 || code > 57) return false;
      portDigits += 1;
      continue;
    }
    const allowed = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) || code === 45 || code === 46;
    if (!allowed) return false;
  }
  return !sawColon || (portDigits > 0 && portDigits <= 5);
}

/**
 * Recognizes catalog endpoints whose URL authority is bound to a configured
 * environment variable via a single `{{env.NAME}}` token (for example
 * `https://{{env.QDRANT_CLUSTER_HOST}}:6333/collections`). The variable must
 * be declared by the connector, and the token must sit inside the URL
 * authority so a resolved value can never rewrite the path. The template
 * itself is validated here; the variable is resolved per execution, where a
 * missing value fails with an actionable configuration error.
 */
function environmentHostBinding(
  connector: LocalCatalogConnector,
  endpoint: IntegrationEndpoint,
  toolId: string,
): EnvironmentHostBinding | undefined {
  const url = endpoint.url;
  if (!stringBoolean(stringIncludes, url, ENVIRONMENT_HOST_PREFIX)) return undefined;

  const unsupportedTemplate = (): never =>
    configurationError(
      `Local integration tool "${toolId}" has an unsupported environment-host endpoint template`,
    );

  if (!stringBoolean(stringStartsWith, url, "https://")) unsupportedTemplate();
  const tokenStart = apply(stringIndexOf, url, [ENVIRONMENT_HOST_PREFIX]) as number;
  const tokenEnd = apply(stringIndexOf, url, ["}}", tokenStart]) as number;
  if (tokenEnd === -1) unsupportedTemplate();
  const afterToken = apply(stringSlice, url, [tokenEnd + 2]) as string;
  if (stringBoolean(stringIncludes, afterToken, ENVIRONMENT_HOST_PREFIX)) {
    unsupportedTemplate();
  }
  const pathStart = apply(stringIndexOf, url, ["/", "https://".length]) as number;
  if (pathStart !== -1 && tokenEnd + 2 > pathStart) unsupportedTemplate();

  const variableName = apply(stringSlice, url, [
    tokenStart + ENVIRONMENT_HOST_PREFIX.length,
    tokenEnd,
  ]) as string;
  if (!isEnvironmentVariableName(variableName)) unsupportedTemplate();

  let declared: NonNullable<LocalCatalogConnector["envVars"]>[number] | undefined;
  for (let index = 0; index < (connector.envVars?.length ?? 0); index++) {
    const envVar = connector.envVars?.[index];
    if (envVar?.name === variableName) declared = envVar;
  }
  if (!declared) {
    configurationError(
      `Local integration tool "${toolId}" binds its host to the undeclared ` +
        `environment variable "${variableName}"`,
    );
  }
  const defaultValue = typeof declared.default === "string" ? declared.default : undefined;
  if (defaultValue !== undefined && !isHostWithOptionalPort(defaultValue)) {
    unsupportedTemplate();
  }

  const token = apply(stringSlice, url, [tokenStart, tokenEnd + 2]) as string;
  // Prove the template resolves to a fixed HTTPS URL for a syntactically
  // valid host before granting the tool; the real origin is pinned at
  // execution time from the resolved variable.
  assertHttpsCatalogUrl(
    apply(stringReplace, url, [token, ENVIRONMENT_HOST_PROBE]) as string,
    `Local integration tool "${toolId}" endpoint`,
  );
  return freeze({ token, variableName, defaultValue });
}

/** Resolve and validate the host an environment-bound endpoint targets. */
async function resolveEnvironmentHost(
  binding: EnvironmentHostBinding,
  credentialProvider: LocalIntegrationCredentialProvider,
): Promise<string> {
  let provided: unknown;
  try {
    provided = await apply(credentialProvider, undefined, [binding.variableName]);
  } catch {
    provided = undefined;
  }
  let value = typeof provided === "string" && provided.length > 0 ? provided : undefined;
  value ??= binding.defaultValue;
  if (value === undefined) {
    throw LOCAL_INTEGRATION_CREDENTIALS_MISSING.create({
      detail: `Set local integration host variables: ${binding.variableName}`,
    });
  }
  if (!isHostWithOptionalPort(value)) {
    configurationError(
      `Local integration host variable ${binding.variableName} must be a bare ` +
        "hostname with an optional port",
    );
  }
  return value;
}

/**
 * Syntactically valid stand-in subdomain label used to validate a tenant-host
 * URL template before any tool argument is available.
 */
const TENANT_HOST_PROBE = "tenant-host-probe";

function isEndpointParameterName(value: string): boolean {
  if (value.length === 0 || value.length > 100) return false;
  for (let index = 0; index < value.length; index++) {
    const code = apply(stringCharCodeAt, value, [index]) as number;
    const allowed = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) || code === 95;
    if (!allowed) return false;
  }
  return true;
}

/**
 * Accepts only a bare DNS label sequence (`label` or `label.label...`). No
 * port, path, userinfo, percent escape, or whitespace can pass, so once the
 * value is substituted for a leading-subdomain placeholder the request can
 * only target a deeper subdomain of the template's fixed registrable domain.
 */
function isTenantHostLabelSequence(value: string): boolean {
  if (value.length === 0 || value.length > 200) return false;
  let labelLength = 0;
  for (let index = 0; index < value.length; index++) {
    const code = apply(stringCharCodeAt, value, [index]) as number;
    if (code === 46) {
      if (labelLength === 0 || labelLength > 63) return false;
      labelLength = 0;
      continue;
    }
    const allowed = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) || code === 45;
    if (!allowed) return false;
    labelLength += 1;
  }
  return labelLength > 0 && labelLength <= 63;
}

/**
 * Recognizes catalog endpoints whose URL authority starts with a single
 * `{param}` placeholder followed by a fixed registrable domain (for example
 * `https://{indexHostPrefix}.pinecone.io/query`). The placeholder must be a
 * whole leading label sequence, must be backed by a required path parameter,
 * and everything after it — including the registrable domain — must be
 * literal, so tool input can pick a provider tenant but never another
 * registrable domain. The template is validated here; the argument itself is
 * validated per execution, where the resolved origin is pinned.
 */
function tenantHostBinding(
  endpoint: IntegrationEndpoint,
  toolId: string,
): TenantHostBinding | undefined {
  const url = endpoint.url;
  if (!stringBoolean(stringStartsWith, url, "https://")) return undefined;
  const pathStart = apply(stringIndexOf, url, ["/", "https://".length]) as number;
  const authority = pathStart === -1
    ? apply(stringSlice, url, ["https://".length]) as string
    : apply(stringSlice, url, ["https://".length, pathStart]) as string;
  if (!stringBoolean(stringIncludes, authority, "{")) return undefined;

  const unsupportedTemplate = (): never =>
    configurationError(
      `Local integration tool "${toolId}" has an unsupported tenant-host endpoint template`,
    );

  if (!stringBoolean(stringStartsWith, authority, "{")) unsupportedTemplate();
  const tokenEnd = apply(stringIndexOf, authority, ["}"]) as number;
  if (tokenEnd === -1) unsupportedTemplate();
  const parameterName = apply(stringSlice, authority, [1, tokenEnd]) as string;
  if (!isEndpointParameterName(parameterName)) unsupportedTemplate();
  const suffix = apply(stringSlice, authority, [tokenEnd + 1]) as string;
  if (
    !stringBoolean(stringStartsWith, suffix, ".") ||
    stringBoolean(stringIncludes, suffix, "{") ||
    stringBoolean(stringIncludes, suffix, "}")
  ) {
    unsupportedTemplate();
  }
  const fixedHost = apply(stringSlice, suffix, [1]) as string;
  if (!isHostWithOptionalPort(fixedHost)) unsupportedTemplate();
  const portStart = apply(stringIndexOf, fixedHost, [":"]) as number;
  const fixedLabels = portStart === -1
    ? fixedHost
    : apply(stringSlice, fixedHost, [0, portStart]) as string;
  // The fixed remainder must already be a registrable domain (two or more
  // labels) so the tool argument only ever extends a provider-owned domain.
  if (!stringBoolean(stringIncludes, fixedLabels, ".")) unsupportedTemplate();

  const parameter = endpoint.params?.[parameterName];
  if (!parameter || parameter.in !== "path" || parameter.required !== true) {
    configurationError(
      `Local integration tool "${toolId}" must back its tenant-host placeholder ` +
        `with the required path parameter "${parameterName}"`,
    );
  }

  const token = `{${parameterName}}`;
  // Prove the template resolves to a fixed HTTPS URL for a syntactically valid
  // host before granting the tool; the real origin is pinned at execution time
  // from the validated argument.
  assertHttpsCatalogUrl(
    apply(stringReplace, url, [token, TENANT_HOST_PROBE]) as string,
    `Local integration tool "${toolId}" endpoint`,
  );
  return freeze({ token, parameterName });
}

/** Read and validate the tenant subdomain argument a bound endpoint targets. */
function tenantHostArgument(
  args: Record<string, unknown>,
  binding: TenantHostBinding,
): string {
  const descriptor = getOwnPropertyDescriptor(args, binding.parameterName);
  const value = descriptor && "value" in descriptor ? descriptor.value : undefined;
  if (typeof value !== "string" || !isTenantHostLabelSequence(value)) {
    throw LOCAL_INTEGRATION_REQUEST_INVALID.create({
      detail: `Local integration argument "${binding.parameterName}" must be a bare ` +
        "hostname prefix (subdomain labels only, without scheme, port, or path)",
    });
  }
  return value;
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
  environmentHost: EnvironmentHostBinding | undefined,
  tenantHost: TenantHostBinding | undefined,
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
  } else if (environmentHost || tenantHost) {
    // The template was validated when the binding was recognized; the real
    // origin is pinned at execution time from the resolved variable or the
    // validated tenant argument.
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

  const environmentHost = connector.name === "salesforce"
    ? undefined
    : environmentHostBinding(connector, tool.endpoint, canonicalToolId);
  const tenantHost = connector.name === "salesforce" || environmentHost
    ? undefined
    : tenantHostBinding(tool.endpoint, canonicalToolId);
  const endpointOrigin = assertSupportedEndpoint(
    connector,
    tool.endpoint,
    canonicalToolId,
    environmentHost,
    tenantHost,
  );
  assertSupportedAuth(connector, tool.endpoint);
  const authPlan = createLocalCredentialAuthPlan(connector);
  return freeze({
    authPlan,
    connector,
    endpoint: tool.endpoint,
    endpointOrigin,
    environmentHost,
    tenantHost,
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
      const validatedHostVariables = new SetConstructor<string>();
      for (let index = 0; index < snapshot.tools.length; index++) {
        const toolId = snapshot.tools[index]!;
        const tool = mapValue(admitted, toolId)!;
        if (
          tool.environmentHost &&
          !apply(setHas, validatedHostVariables, [tool.environmentHost.variableName])
        ) {
          await resolveEnvironmentHost(tool.environmentHost, credentialProvider);
          apply(setAdd, validatedHostVariables, [tool.environmentHost.variableName]);
        }
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
      if (tool.tenantHost) {
        // Validated and pinned before any credential is minted so a hostile
        // argument is rejected without a token request ever being sent.
        const tenantLabels = tenantHostArgument(validated.args, tool.tenantHost);
        const resolvedUrl = apply(stringReplace, endpoint.url, [
          tool.tenantHost.token,
          tenantLabels,
        ]) as string;
        // Re-checked with the resolved labels so the admitted origin below is
        // derived from the same URL the request will use.
        allowedOrigin = assertHttpsCatalogUrl(
          resolvedUrl,
          `Local integration tool "${toolName}" endpoint`,
        );
        endpoint = freeze({ ...endpoint, url: resolvedUrl });
      }
      const auth = await mintLocalCredentialAuth(
        await resolveLocalCredentialAuth(tool.authPlan, credentialProvider),
        toolName,
        context?.abortSignal,
        transport,
      );
      if (tool.environmentHost) {
        const host = await resolveEnvironmentHost(tool.environmentHost, credentialProvider);
        const resolvedUrl = apply(stringReplace, endpoint.url, [
          tool.environmentHost.token,
          host,
        ]) as string;
        // Re-checked with the resolved host so the admitted origin below is
        // derived from the same URL the request will use.
        allowedOrigin = assertHttpsCatalogUrl(
          resolvedUrl,
          `Local integration tool "${toolName}" endpoint`,
        );
        endpoint = freeze({ ...endpoint, url: resolvedUrl });
      }
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
