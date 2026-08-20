import type { LocalIntegrationCredentialProvider } from "#veryfront/integrations/local-tool-source.ts";
import type { IntegrationConfig } from "#veryfront/integrations/schema.ts";
import {
  LOCAL_INTEGRATION_CREDENTIAL_UNAVAILABLE,
  LOCAL_INTEGRATION_CREDENTIALS_MISSING,
  localIntegrationConfigurationError,
  localIntegrationResponseInvalid,
} from "#veryfront/integrations/local-integration-errors.ts";
import {
  executeLocalIntegrationJsonRequest,
  type LocalIntegrationEndpointTransport,
} from "#veryfront/integrations/local-endpoint-executor.ts";
import {
  MAX_LOCAL_INTEGRATION_CREDENTIAL_NAME_LENGTH,
  MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH,
} from "#veryfront/integrations/limits.ts";

const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const arrayJoin = Array.prototype.join;
const encodeUriComponent = encodeURIComponent;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectEntries = Object.entries;
const objectValues = Object.values;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringEndsWith = String.prototype.endsWith;
const stringIncludes = String.prototype.includes;
const stringSlice = String.prototype.slice;
const stringToLowerCase = String.prototype.toLowerCase;
const stringTrim = String.prototype.trim;
const textEncoder = new TextEncoder();
const textEncoderEncode = TextEncoder.prototype.encode;
const URLConstructor = URL;
const URLSearchParamsConstructor = URLSearchParams;
const urlSearchParamsToString = URLSearchParams.prototype.toString;
const urlHash = getOwnPropertyDescriptor(URL.prototype, "hash")?.get;
const urlHostname = getOwnPropertyDescriptor(URL.prototype, "hostname")?.get;
const urlOrigin = getOwnPropertyDescriptor(URL.prototype, "origin")?.get;
const urlPassword = getOwnPropertyDescriptor(URL.prototype, "password")?.get;
const urlPathname = getOwnPropertyDescriptor(URL.prototype, "pathname")?.get;
const urlPort = getOwnPropertyDescriptor(URL.prototype, "port")?.get;
const urlProtocol = getOwnPropertyDescriptor(URL.prototype, "protocol")?.get;
const urlSearch = getOwnPropertyDescriptor(URL.prototype, "search")?.get;
const urlUsername = getOwnPropertyDescriptor(URL.prototype, "username")?.get;

interface LocalCredentialAuthPlanBase {
  readonly connectorName: string;
  readonly requiredEnvironmentVariables: readonly string[];
}

interface LocalApiKeyAuthPlan extends LocalCredentialAuthPlanBase {
  readonly kind: "api-key";
  readonly keyName: string;
  readonly headerName: string;
  readonly headerPrefix?: string;
  readonly additionalHeaders: Readonly<Record<string, string>>;
}

interface LocalBasicAuthPlan extends LocalCredentialAuthPlanBase {
  readonly kind: "basic";
  readonly usernameName: string;
  readonly passwordName: string;
  readonly passwordFallback?: string;
  readonly additionalHeaders: Readonly<Record<string, string>>;
}

interface LocalClientCredentialsAuthPlan extends LocalCredentialAuthPlanBase {
  readonly kind: "client-credentials";
  readonly additionalParams: Readonly<Record<string, string>>;
  readonly clientIdName: string;
  readonly clientSecretName: string;
  readonly scopes: readonly string[];
  readonly tokenAuthMethod: "basic" | "request-body";
  readonly tokenUrl: string;
}

interface LocalSalesforceServiceAccountAuthPlan extends LocalCredentialAuthPlanBase {
  readonly kind: "salesforce-service-account";
  readonly clientIdName: "SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID";
  readonly clientSecretName: "SALESFORCE_SERVICE_ACCOUNT_CLIENT_SECRET";
  readonly loginUrlName: "SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL";
}

export type LocalCredentialAuthPlan =
  | LocalApiKeyAuthPlan
  | LocalBasicAuthPlan
  | LocalClientCredentialsAuthPlan
  | LocalSalesforceServiceAccountAuthPlan;

export interface ResolvedLocalHeaderAuth {
  readonly kind: "headers";
  readonly connectorName: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface ResolvedLocalTokenRequest {
  readonly kind: "token-request";
  readonly connectorName: string;
  readonly mode: "client-credentials" | "salesforce-service-account";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type ResolvedLocalCredentialAuth =
  | ResolvedLocalHeaderAuth
  | ResolvedLocalTokenRequest;

export interface ResolvedLocalExecutionAuth {
  readonly headers: Readonly<Record<string, string>>;
  readonly instanceOrigin?: string;
}

function stringCall(
  operation: (this: string, ...args: never[]) => string,
  value: string,
): string {
  return apply(operation, value, []);
}

function stringEndsWithValue(value: string, suffix: string): boolean {
  return apply(stringEndsWith, value, [suffix]);
}

function stringIncludesValue(value: string, search: string): boolean {
  return apply(stringIncludes, value, [search]);
}

function append<T>(values: T[], value: T): void {
  objectDefineProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function join(values: readonly string[], separator: string): string {
  return apply(arrayJoin, values, [separator]) as string;
}

function compareStrings(left: string, right: string): number {
  const length = left.length < right.length ? left.length : right.length;
  for (let index = 0; index < length; index++) {
    const leftCode = apply(stringCharCodeAt, left, [index]) as number;
    const rightCode = apply(stringCharCodeAt, right, [index]) as number;
    if (leftCode !== rightCode) return leftCode - rightCode;
  }
  return left.length - right.length;
}

function sortStrings(values: string[]): void {
  for (let index = 1; index < values.length; index++) {
    const value = values[index]!;
    let insertionIndex = index;
    while (
      insertionIndex > 0 &&
      compareStrings(values[insertionIndex - 1]!, value) > 0
    ) {
      objectDefineProperty(values, insertionIndex, {
        configurable: true,
        enumerable: true,
        value: values[insertionIndex - 1],
        writable: true,
      });
      insertionIndex -= 1;
    }
    objectDefineProperty(values, insertionIndex, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
}

function urlValue(getter: ((this: URL) => string) | undefined, url: URL): string {
  if (!getter) localIntegrationConfigurationError("URL parsing is unavailable in this runtime");
  return apply(getter, url, []);
}

function parseUrl(value: string, label: string): URL {
  try {
    return new URLConstructor(value);
  } catch {
    localIntegrationConfigurationError(`${label} must be a valid URL`);
  }
}

function assertFixedHttpsUrl(value: string, label: string): string {
  const parsed = parseUrl(value, label);
  if (
    urlValue(urlProtocol, parsed) !== "https:" ||
    urlValue(urlUsername, parsed) !== "" ||
    urlValue(urlPassword, parsed) !== "" ||
    urlValue(urlHash, parsed) !== ""
  ) {
    localIntegrationConfigurationError(`${label} must be a fixed HTTPS URL without credentials`);
  }
  return value;
}

function declaredFallback(
  connector: Pick<IntegrationConfig, "envVars">,
  name: string,
): string | undefined {
  for (let index = 0; index < (connector.envVars?.length ?? 0); index++) {
    const envVar = connector.envVars?.[index];
    if (envVar?.name !== name) continue;
    if (envVar.default !== undefined) return envVar.default;
    return envVar.required === false ? "" : undefined;
  }
  return undefined;
}

function assertCanonicalCredentialName(value: string, connectorName: string): string {
  if (value.length === 0 || value.length > MAX_LOCAL_INTEGRATION_CREDENTIAL_NAME_LENGTH) {
    localIntegrationConfigurationError(
      `Local integration "${connectorName}" has an invalid credential name`,
    );
  }
  for (let index = 0; index < value.length; index++) {
    const code = apply(stringCharCodeAt, value, [index]) as number;
    const allowed = code === 95 || code >= 65 && code <= 90 || code >= 97 && code <= 122 ||
      (index > 0 && code >= 48 && code <= 57);
    if (!allowed) {
      localIntegrationConfigurationError(
        `Local integration "${connectorName}" has an invalid credential name`,
      );
    }
  }
  return value;
}

function canonicalCredentialNames(values: readonly string[], connectorName: string): string[] {
  const canonical: string[] = [];
  for (let index = 0; index < values.length; index++) {
    append(canonical, assertCanonicalCredentialName(values[index]!, connectorName));
  }
  return canonical;
}

function declaredClientCredentialName(
  connector: Pick<IntegrationConfig, "envVars" | "name">,
  suffix: "_CLIENT_ID" | "_CLIENT_SECRET",
): string {
  let matched: string | undefined;
  for (let index = 0; index < (connector.envVars?.length ?? 0); index++) {
    const name = connector.envVars?.[index]?.name;
    if (typeof name !== "string" || !stringEndsWithValue(name, suffix)) continue;
    if (matched !== undefined) {
      localIntegrationConfigurationError(
        `Local integration "${connector.name}" declares multiple ${suffix} credentials`,
      );
    }
    matched = assertCanonicalCredentialName(name, connector.name);
  }
  if (matched === undefined) {
    localIntegrationConfigurationError(
      `Local integration "${connector.name}" is missing its ${suffix} credential`,
    );
  }
  return matched;
}

function copyTokenParams(
  values: Readonly<Record<string, string>> | undefined,
  connectorName: string,
): Record<string, string> {
  const copied: Record<string, string> = objectCreate(null);
  const entries = objectEntries(values ?? {});
  for (let index = 0; index < entries.length; index++) {
    const [name, value] = entries[index]!;
    if (
      name.length === 0 || typeof value !== "string" ||
      name === "grant_type" || name === "client_id" || name === "client_secret" ||
      name === "scope"
    ) {
      localIntegrationConfigurationError(
        `Local integration "${connectorName}" declares an invalid token parameter`,
      );
    }
    objectDefineProperty(copied, name, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  return copied;
}

/** Build a serializable, value-free credential plan from trusted catalog metadata. */
export function createLocalCredentialAuthPlan(
  connector: Pick<IntegrationConfig, "auth" | "envVars" | "name">,
): LocalCredentialAuthPlan {
  const auth = connector.auth;
  if (connector.name === "salesforce") {
    return freeze({
      kind: "salesforce-service-account",
      connectorName: connector.name,
      clientIdName: "SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID",
      clientSecretName: "SALESFORCE_SERVICE_ACCOUNT_CLIENT_SECRET",
      loginUrlName: "SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL",
      requiredEnvironmentVariables: freeze([
        "SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID",
        "SALESFORCE_SERVICE_ACCOUNT_CLIENT_SECRET",
        "SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL",
      ]),
    });
  }

  if (auth.type === "api-key") {
    if (auth.queryParamName) {
      localIntegrationConfigurationError(
        `Local integration "${connector.name}" uses unsupported query credentials`,
      );
    }
    if (!auth.keyName) {
      localIntegrationConfigurationError(
        `Local integration "${connector.name}" is missing its API-key name`,
      );
    }
    const additionalHeaders = freeze({ ...auth.additionalHeaders });
    const required = [assertCanonicalCredentialName(auth.keyName, connector.name)];
    const additionalNames = objectValues(additionalHeaders);
    for (let index = 0; index < additionalNames.length; index++) {
      append(
        required,
        assertCanonicalCredentialName(additionalNames[index]!, connector.name),
      );
    }
    return freeze({
      kind: "api-key",
      connectorName: connector.name,
      keyName: required[0]!,
      headerName: auth.headerName ?? "Authorization",
      headerPrefix: auth.headerPrefix,
      additionalHeaders,
      requiredEnvironmentVariables: freeze(required),
    });
  }

  if (auth.type === "basic") {
    if (!auth.usernameKey || !auth.passwordKey) {
      localIntegrationConfigurationError(
        `Local integration "${connector.name}" is missing Basic credential names`,
      );
    }
    const additionalHeaders = freeze({ ...auth.additionalHeaders });
    const usernameName = assertCanonicalCredentialName(auth.usernameKey, connector.name);
    const passwordName = assertCanonicalCredentialName(auth.passwordKey, connector.name);
    const required = [usernameName, passwordName];
    const additionalNames = objectValues(additionalHeaders);
    for (let index = 0; index < additionalNames.length; index++) {
      append(
        required,
        assertCanonicalCredentialName(additionalNames[index]!, connector.name),
      );
    }
    return freeze({
      kind: "basic",
      connectorName: connector.name,
      usernameName,
      passwordName,
      passwordFallback: declaredFallback(connector, passwordName),
      additionalHeaders,
      requiredEnvironmentVariables: freeze(required),
    });
  }

  if (auth.type === "oauth2" && auth.grantType === "client_credentials") {
    if (!auth.tokenUrl || stringIncludesValue(auth.tokenUrl, "{{")) {
      localIntegrationConfigurationError(
        `Local integration "${connector.name}" requires a fixed token URL`,
      );
    }
    const clientIdName = declaredClientCredentialName(connector, "_CLIENT_ID");
    const clientSecretName = declaredClientCredentialName(connector, "_CLIENT_SECRET");
    const additionalParams = freeze(copyTokenParams(auth.additionalParams, connector.name));
    let tokenAuthMethod: LocalClientCredentialsAuthPlan["tokenAuthMethod"];
    if (auth.tokenAuthMethod === "basic") tokenAuthMethod = "basic";
    else if (auth.tokenAuthMethod === "request_body") tokenAuthMethod = "request-body";
    else {
      localIntegrationConfigurationError(
        `Local integration "${connector.name}" uses an unsupported token authentication method`,
      );
    }
    const required = canonicalCredentialNames(
      [clientIdName, clientSecretName],
      connector.name,
    );
    return freeze({
      kind: "client-credentials",
      connectorName: connector.name,
      additionalParams,
      clientIdName,
      clientSecretName,
      scopes: freeze(copyStrings(auth.scopes ?? [])),
      tokenAuthMethod,
      tokenUrl: assertFixedHttpsUrl(
        auth.tokenUrl,
        `Local integration "${connector.name}" token URL`,
      ),
      requiredEnvironmentVariables: freeze(required),
    });
  }

  localIntegrationConfigurationError(
    `Local integration "${connector.name}" uses unsupported authorization-code credentials`,
  );
}

function copyStrings(values: readonly string[]): string[] {
  const copied: string[] = [];
  for (let index = 0; index < values.length; index++) append(copied, values[index]!);
  return copied;
}

function base64(value: string): string {
  const bytes = apply(textEncoderEncode, textEncoder, [value]) as Uint8Array;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const secondPresent = index + 1 < bytes.length;
    const thirdPresent = index + 2 < bytes.length;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    result += alphabet[first >> 2];
    result += alphabet[((first & 3) << 4) | (second >> 4)];
    result += secondPresent ? alphabet[((second & 15) << 2) | (third >> 6)] : "=";
    result += thirdPresent ? alphabet[third & 63] : "=";
  }
  return result;
}

function formEntry(name: string, value: string): string {
  return `${encodeUriComponent(name)}=${encodeUriComponent(value)}`;
}

function formComponent(value: string): string {
  const params = new URLSearchParamsConstructor([["value", value]]);
  const serialized = apply(urlSearchParamsToString, params, []) as string;
  return apply(stringSlice, serialized, ["value=".length]) as string;
}

async function readCredential(
  provider: LocalIntegrationCredentialProvider,
  connectorName: string,
  name: string,
): Promise<string | undefined> {
  let value: unknown;
  try {
    value = await apply(provider, undefined, [name]);
  } catch {
    throw LOCAL_INTEGRATION_CREDENTIAL_UNAVAILABLE.create({
      detail: `The credential provider could not read ${name} for ${connectorName}`,
    });
  }
  if (typeof value !== "string") return undefined;
  const trimmed = stringCall(stringTrim, value);
  if (
    trimmed.length === 0 || trimmed.length !== value.length ||
    value.length > MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH
  ) {
    return undefined;
  }
  // A control character or edge whitespace in a header value makes fetch
  // reject the request as an opaque runtime error instead of a clear
  // credential error, so fail closed here where the offending credential is
  // still known by name.
  for (let index = 0; index < value.length; index++) {
    const code = apply(stringCharCodeAt, value, [index]) as number;
    if (code < 0x20 || code === 0x7f) return undefined;
  }
  return value;
}

async function readCredentials(
  plan: LocalCredentialAuthPlan,
  provider: LocalIntegrationCredentialProvider,
): Promise<Record<string, string>> {
  const values: Record<string, string> = objectCreate(null);
  const missing: string[] = [];
  for (let index = 0; index < plan.requiredEnvironmentVariables.length; index++) {
    const name = plan.requiredEnvironmentVariables[index]!;
    const value = await readCredential(provider, plan.connectorName, name);
    // RFC 7617 delimits the Basic user-id from the password with the first
    // `:`, so a username containing one would silently shift part of itself
    // into the password. Fail closed as a missing credential.
    if (
      value === undefined ||
      (plan.kind === "basic" && name === plan.usernameName &&
        stringIncludesValue(value, ":"))
    ) {
      append(missing, name);
    } else values[name] = value;
  }
  if (
    plan.kind === "basic" && values[plan.passwordName] === undefined &&
    plan.passwordFallback !== undefined
  ) {
    values[plan.passwordName] = plan.passwordFallback;
    for (let index = 0; index < missing.length; index++) {
      if (missing[index] !== plan.passwordName) continue;
      for (let next = index + 1; next < missing.length; next++) {
        objectDefineProperty(missing, next - 1, {
          configurable: true,
          enumerable: true,
          value: missing[next],
          writable: true,
        });
      }
      missing.length -= 1;
      break;
    }
  }
  if (missing.length > 0) {
    sortStrings(missing);
    throw LOCAL_INTEGRATION_CREDENTIALS_MISSING.create({
      detail: `Set local integration credential variables: ${join(missing, ", ")}`,
    });
  }
  return values;
}

function parseSalesforceOrigin(value: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URLConstructor(value);
  } catch {
    return undefined;
  }
  const protocol = urlValue(urlProtocol, parsed);
  const hostname = stringCall(stringToLowerCase, urlValue(urlHostname, parsed));
  const pathname = urlValue(urlPathname, parsed);
  if (
    protocol !== "https:" || urlValue(urlPort, parsed) !== "" ||
    urlValue(urlUsername, parsed) !== "" || urlValue(urlPassword, parsed) !== "" ||
    urlValue(urlSearch, parsed) !== "" || urlValue(urlHash, parsed) !== "" ||
    (pathname !== "" && pathname !== "/") ||
    (!stringEndsWithValue(hostname, ".my.salesforce.com") &&
      !stringEndsWithValue(hostname, ".my-salesforce.com"))
  ) {
    return undefined;
  }
  return `https://${hostname}`;
}

function normalizeSalesforceLoginUrl(value: string): string {
  const origin = parseSalesforceOrigin(value);
  if (!origin) {
    localIntegrationConfigurationError(
      "Salesforce service-account login URL must be an HTTPS Salesforce My Domain origin",
    );
  }
  return origin;
}

function tokenResponseInvalid(
  connectorName: string,
  toolId: string,
  status: number,
): never {
  return localIntegrationResponseInvalid({ connectorName, toolId }, status);
}

function tokenResponseString(
  value: Record<string, unknown>,
  key: string,
  connectorName: string,
  toolId: string,
  status: number,
): string {
  const descriptor = getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
    tokenResponseInvalid(connectorName, toolId, status);
  }
  const result = descriptor.value;
  if (
    stringCall(stringTrim, result).length === 0 ||
    result.length > MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH
  ) {
    tokenResponseInvalid(connectorName, toolId, status);
  }
  return result;
}

function tokenResponseRecord(
  value: unknown,
  connectorName: string,
  toolId: string,
  status: number,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || arrayIsArray(value)) {
    tokenResponseInvalid(connectorName, toolId, status);
  }
  return value as Record<string, unknown>;
}

/** Resolve short-lived secret values for a previously validated auth plan. */
export async function resolveLocalCredentialAuth(
  plan: LocalCredentialAuthPlan,
  provider: LocalIntegrationCredentialProvider,
): Promise<ResolvedLocalCredentialAuth> {
  const values = await readCredentials(plan, provider);

  if (plan.kind === "api-key") {
    const key = values[plan.keyName]!;
    const headers: Record<string, string> = objectCreate(null);
    headers[plan.headerName] = plan.headerPrefix ? `${plan.headerPrefix} ${key}` : key;
    const additionalEntries = objectEntries(plan.additionalHeaders);
    for (let index = 0; index < additionalEntries.length; index++) {
      const [headerName, environmentName] = additionalEntries[index]!;
      headers[headerName] = values[environmentName]!;
    }
    return freeze({ kind: "headers", connectorName: plan.connectorName, headers: freeze(headers) });
  }

  if (plan.kind === "basic") {
    const credential = `${values[plan.usernameName]!}:${values[plan.passwordName]!}`;
    const headers: Record<string, string> = objectCreate(null);
    headers.Authorization = `Basic ${base64(credential)}`;
    const additionalEntries = objectEntries(plan.additionalHeaders);
    for (let index = 0; index < additionalEntries.length; index++) {
      const [headerName, environmentName] = additionalEntries[index]!;
      headers[headerName] = values[environmentName]!;
    }
    return freeze({
      kind: "headers",
      connectorName: plan.connectorName,
      headers: freeze(headers),
    });
  }

  if (plan.kind === "client-credentials") {
    const clientId = values[plan.clientIdName]!;
    const clientSecret = values[plan.clientSecretName]!;
    const body = [formEntry("grant_type", "client_credentials")];
    if (plan.scopes.length > 0) append(body, formEntry("scope", join(plan.scopes, " ")));
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (plan.tokenAuthMethod === "request-body") {
      append(body, formEntry("client_id", clientId));
      append(body, formEntry("client_secret", clientSecret));
    } else {
      headers.Authorization = `Basic ${
        base64(
          `${formComponent(clientId)}:${formComponent(clientSecret)}`,
        )
      }`;
    }
    const additionalEntries = objectEntries(plan.additionalParams);
    for (let index = 0; index < additionalEntries.length; index++) {
      const [name, value] = additionalEntries[index]!;
      append(body, formEntry(name, value));
    }
    return freeze({
      kind: "token-request",
      connectorName: plan.connectorName,
      mode: "client-credentials",
      url: plan.tokenUrl,
      headers: freeze(headers),
      body: join(body, "&"),
    });
  }

  const loginOrigin = normalizeSalesforceLoginUrl(values[plan.loginUrlName]!);
  return freeze({
    kind: "token-request",
    connectorName: plan.connectorName,
    mode: "salesforce-service-account",
    url: `${loginOrigin}/services/oauth2/token`,
    headers: freeze({
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    }),
    body: join([
      formEntry("grant_type", "client_credentials"),
      formEntry("client_id", values[plan.clientIdName]!),
      formEntry("client_secret", values[plan.clientSecretName]!),
    ], "&"),
  });
}

/** Mint a short-lived bearer credential from a previously resolved local auth request. */
export async function mintLocalCredentialAuth(
  resolved: ResolvedLocalCredentialAuth,
  toolId: string,
  signal?: AbortSignal,
  transport?: LocalIntegrationEndpointTransport,
): Promise<ResolvedLocalExecutionAuth> {
  if (resolved.kind === "headers") {
    return freeze({ headers: resolved.headers });
  }

  const tokenUrl = parseUrl(resolved.url, "Local integration token URL");
  const tokenOrigin = urlValue(urlOrigin, tokenUrl);
  const tokenResult = await executeLocalIntegrationJsonRequest({
    connectorName: resolved.connectorName,
    toolId,
    url: resolved.url,
    method: "POST",
    headers: resolved.headers,
    body: resolved.body,
    allowedOrigin: tokenOrigin,
    signal,
    transport,
  });
  const response = tokenResponseRecord(
    tokenResult.value,
    resolved.connectorName,
    toolId,
    tokenResult.status,
  );
  const accessToken = tokenResponseString(
    response,
    "access_token",
    resolved.connectorName,
    toolId,
    tokenResult.status,
  );
  const tokenType = stringCall(
    stringToLowerCase,
    tokenResponseString(
      response,
      "token_type",
      resolved.connectorName,
      toolId,
      tokenResult.status,
    ),
  );
  if (tokenType !== "bearer") {
    tokenResponseInvalid(resolved.connectorName, toolId, tokenResult.status);
  }

  const headers = freeze({ Authorization: `Bearer ${accessToken}` });
  if (resolved.mode === "client-credentials") return freeze({ headers });

  return freeze({
    headers,
    instanceOrigin: parseSalesforceOrigin(
      tokenResponseString(
        response,
        "instance_url",
        resolved.connectorName,
        toolId,
        tokenResult.status,
      ),
    ) ?? tokenResponseInvalid(resolved.connectorName, toolId, tokenResult.status),
  });
}
