import type { LocalIntegrationCredentialProvider } from "./local-tool-source.ts";
import type { IntegrationConfig } from "./schema.ts";
import {
  LOCAL_INTEGRATION_CREDENTIAL_UNAVAILABLE,
  LOCAL_INTEGRATION_CREDENTIALS_MISSING,
  localIntegrationConfigurationError,
} from "./local-integration-errors.ts";
import { MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH } from "./limits.ts";

const apply = Reflect.apply;
const encodeUriComponent = encodeURIComponent;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const stringEndsWith = String.prototype.endsWith;
const stringToLowerCase = String.prototype.toLowerCase;
const stringTrim = String.prototype.trim;
const textEncoder = new TextEncoder();
const textEncoderEncode = TextEncoder.prototype.encode;
const URLConstructor = URL;
const urlHash = getOwnPropertyDescriptor(URL.prototype, "hash")?.get;
const urlHostname = getOwnPropertyDescriptor(URL.prototype, "hostname")?.get;
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
}

interface LocalClientCredentialsAuthPlan extends LocalCredentialAuthPlanBase {
  readonly kind: "client-credentials";
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

function stringCall(
  operation: (this: string, ...args: never[]) => string,
  value: string,
): string {
  return apply(operation, value, []);
}

function stringEndsWithValue(value: string, suffix: string): boolean {
  return apply(stringEndsWith, value, [suffix]);
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

function normalizedConnectorPrefix(name: string): string {
  let prefix = "";
  for (let index = 0; index < name.length; index++) {
    const code = name.charCodeAt(index);
    if (code >= 97 && code <= 122) prefix += String.fromCharCode(code - 32);
    else if (code >= 65 && code <= 90 || code >= 48 && code <= 57) prefix += name[index];
    else prefix += "_";
  }
  return prefix;
}

function declaredFallback(connector: IntegrationConfig, name: string): string | undefined {
  for (let index = 0; index < (connector.envVars?.length ?? 0); index++) {
    const envVar = connector.envVars?.[index];
    if (envVar?.name !== name) continue;
    if (envVar.default !== undefined) return envVar.default;
    return envVar.required === false ? "" : undefined;
  }
  return undefined;
}

/** Build a serializable, value-free credential plan from trusted catalog metadata. */
export function createLocalCredentialAuthPlan(
  connector: IntegrationConfig,
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
    const required = [auth.keyName, ...Object.values(additionalHeaders)];
    return freeze({
      kind: "api-key",
      connectorName: connector.name,
      keyName: auth.keyName,
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
    return freeze({
      kind: "basic",
      connectorName: connector.name,
      usernameName: auth.usernameKey,
      passwordName: auth.passwordKey,
      passwordFallback: declaredFallback(connector, auth.passwordKey),
      requiredEnvironmentVariables: freeze([auth.usernameKey, auth.passwordKey]),
    });
  }

  if (auth.type === "oauth2" && auth.grantType === "client_credentials") {
    if (!auth.tokenUrl || auth.tokenUrl.includes("{{")) {
      localIntegrationConfigurationError(
        `Local integration "${connector.name}" requires a fixed token URL`,
      );
    }
    const prefix = normalizedConnectorPrefix(connector.name);
    const clientIdName = `${prefix}_CLIENT_ID`;
    const clientSecretName = `${prefix}_CLIENT_SECRET`;
    const requestBodyAuth = auth.tokenAuthMethod === "post" ||
      auth.tokenAuthMethod === "request_body";
    return freeze({
      kind: "client-credentials",
      connectorName: connector.name,
      clientIdName,
      clientSecretName,
      scopes: freeze([...(auth.scopes ?? [])]),
      tokenAuthMethod: requestBodyAuth ? "request-body" : "basic",
      tokenUrl: assertFixedHttpsUrl(
        auth.tokenUrl,
        `Local integration "${connector.name}" token URL`,
      ),
      requiredEnvironmentVariables: freeze([clientIdName, clientSecretName]),
    });
  }

  localIntegrationConfigurationError(
    `Local integration "${connector.name}" uses unsupported authorization-code credentials`,
  );
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
  if (trimmed.length === 0 || value.length > MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH) {
    return undefined;
  }
  return value;
}

async function readCredentials(
  plan: LocalCredentialAuthPlan,
  provider: LocalIntegrationCredentialProvider,
): Promise<Record<string, string>> {
  const values: Record<string, string> = Object.create(null);
  const missing: string[] = [];
  for (let index = 0; index < plan.requiredEnvironmentVariables.length; index++) {
    const name = plan.requiredEnvironmentVariables[index]!;
    const value = await readCredential(provider, plan.connectorName, name);
    if (value === undefined) missing.push(name);
    else values[name] = value;
  }
  if (
    plan.kind === "basic" && values[plan.passwordName] === undefined &&
    plan.passwordFallback !== undefined
  ) {
    values[plan.passwordName] = plan.passwordFallback;
    const missingIndex = missing.indexOf(plan.passwordName);
    if (missingIndex >= 0) missing.splice(missingIndex, 1);
  }
  if (missing.length > 0) {
    throw LOCAL_INTEGRATION_CREDENTIALS_MISSING.create({
      detail: `Set local integration credential variables: ${missing.join(", ")}`,
    });
  }
  return values;
}

function normalizeSalesforceLoginUrl(value: string): string {
  const parsed = parseUrl(value, "Salesforce service-account login URL");
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
    localIntegrationConfigurationError(
      "Salesforce service-account login URL must be an HTTPS Salesforce My Domain origin",
    );
  }
  return `https://${hostname}`;
}

/** Resolve short-lived secret values for a previously validated auth plan. */
export async function resolveLocalCredentialAuth(
  plan: LocalCredentialAuthPlan,
  provider: LocalIntegrationCredentialProvider,
): Promise<ResolvedLocalCredentialAuth> {
  const values = await readCredentials(plan, provider);

  if (plan.kind === "api-key") {
    const key = values[plan.keyName]!;
    const headers: Record<string, string> = Object.create(null);
    headers[plan.headerName] = plan.headerPrefix ? `${plan.headerPrefix} ${key}` : key;
    for (const [headerName, environmentName] of Object.entries(plan.additionalHeaders)) {
      headers[headerName] = values[environmentName]!;
    }
    return freeze({ kind: "headers", connectorName: plan.connectorName, headers: freeze(headers) });
  }

  if (plan.kind === "basic") {
    const credential = `${values[plan.usernameName]!}:${values[plan.passwordName]!}`;
    return freeze({
      kind: "headers",
      connectorName: plan.connectorName,
      headers: freeze({ Authorization: `Basic ${base64(credential)}` }),
    });
  }

  if (plan.kind === "client-credentials") {
    const clientId = values[plan.clientIdName]!;
    const clientSecret = values[plan.clientSecretName]!;
    const body = [formEntry("grant_type", "client_credentials")];
    if (plan.scopes.length > 0) body.push(formEntry("scope", plan.scopes.join(" ")));
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (plan.tokenAuthMethod === "request-body") {
      body.push(formEntry("client_id", clientId));
      body.push(formEntry("client_secret", clientSecret));
    } else {
      headers.Authorization = `Basic ${base64(`${clientId}:${clientSecret}`)}`;
    }
    return freeze({
      kind: "token-request",
      connectorName: plan.connectorName,
      mode: "client-credentials",
      url: plan.tokenUrl,
      headers: freeze(headers),
      body: body.join("&"),
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
    body: [
      formEntry("grant_type", "client_credentials"),
      formEntry("client_id", values[plan.clientIdName]!),
      formEntry("client_secret", values[plan.clientSecretName]!),
    ].join("&"),
  });
}
