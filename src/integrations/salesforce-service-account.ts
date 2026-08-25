/**
 * Local Salesforce service-account integration tools.
 *
 * This source is opt-in. Materialize its tools with
 * `loadRemoteToolsFromSource` and pass the result through an agent's `tools`
 * field. It never registers globally or sends Salesforce credentials to
 * Veryfront APIs.
 */

import { getEnv } from "#veryfront/platform/compat/process.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { createOriginBoundOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { connectors } from "./_data.ts";
import { guardLocalCredentialSource } from "./local-credential-host-policy.ts";
import {
  INTEGRATION_REQUEST_TIMEOUT_MS,
  MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES,
  MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH,
} from "./limits.ts";
import type { IntegrationToolMeta } from "./schema.ts";
import { parseIntegrationToolIdentity } from "./source-policy.ts";

/** Project environment variables required by the local Salesforce service-account source. */
export const SALESFORCE_SERVICE_ACCOUNT_ENV_VARS = [
  "SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID",
  "SALESFORCE_SERVICE_ACCOUNT_CLIENT_SECRET",
  "SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL",
] as const;

const [CLIENT_ID_ENV, CLIENT_SECRET_ENV, LOGIN_URL_ENV] = SALESFORCE_SERVICE_ACCOUNT_ENV_VARS;
const SALESFORCE_INTEGRATION = "salesforce";
const SALESFORCE_TOKEN_PATH = "/services/oauth2/token";
const TOKEN_RESPONSE_LIMIT_BYTES = 64 * 1024;
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1_000;

type SalesforceServiceAccountEnvVar = (typeof SALESFORCE_SERVICE_ACCOUNT_ENV_VARS)[number];
type OriginBoundFetchFactory = (baseUrl: string) => typeof fetch;

/** Options for the local Salesforce service-account source. */
export interface SalesforceServiceAccountToolSourceOptions {
  /** Exact canonical Salesforce tool names exposed by this source. */
  allowedTools: readonly string[];
}

interface SalesforceServiceAccountToolSourceTransportOptions
  extends SalesforceServiceAccountToolSourceOptions {
  createOriginBoundFetch: OriginBoundFetchFactory;
}

interface SalesforceCredentials {
  clientId: string;
  clientSecret: string;
  loginOrigin: string;
}

interface SalesforceToken {
  accessToken: string;
  instanceOrigin: string;
}

interface SalesforceTokenCache extends SalesforceToken, SalesforceCredentials {
  expiresAt: number;
}

class SalesforceTokenFailure extends Error {
  constructor(
    readonly kind: "auth" | "api",
    readonly status?: number,
  ) {
    super("Salesforce token request failed");
    this.name = "SalesforceTokenFailure";
  }
}

interface SalesforceEndpointResult {
  status: number;
  result: unknown;
}

interface RequestSignalScope {
  signal: AbortSignal;
  dispose(): void;
}

type SalesforceEndpoint = NonNullable<IntegrationToolMeta["endpoint"]>;
type SalesforceEndpointParam = NonNullable<SalesforceEndpoint["params"]>[string];
type SalesforceEndpointBodyField = NonNullable<SalesforceEndpoint["body"]>[string];
type SalesforceEndpointInput = SalesforceEndpointParam | SalesforceEndpointBodyField;

const salesforceConnector = connectors.find((connector) =>
  connector.name === SALESFORCE_INTEGRATION
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getToolId(tool: IntegrationToolMeta): string | undefined {
  return tool.id ?? tool.name.toLowerCase().replace(/\s+/g, "_");
}

function getSalesforceTool(toolName: string): IntegrationToolMeta | undefined {
  return salesforceConnector?.tools.find((tool) => getToolId(tool) === toolName);
}

function resolveAllowedTools(allowedTools: readonly string[]): readonly IntegrationToolMeta[] {
  if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
    throw new TypeError("Salesforce service-account source requires at least one allowed tool");
  }

  const seen = new Set<string>();
  return Object.freeze(allowedTools.map((toolName) => {
    if (typeof toolName !== "string") {
      throw new TypeError("Salesforce service-account allowed tools must be strings");
    }
    const identity = parseIntegrationToolIdentity(toolName);
    if (
      identity?.integration !== SALESFORCE_INTEGRATION ||
      toolName !== `${identity.integration}__${identity.toolId}`
    ) {
      throw new TypeError(
        `Salesforce service-account tool "${toolName}" must use the canonical salesforce__tool_id name`,
      );
    }
    if (seen.has(toolName)) {
      throw new TypeError(`Salesforce service-account allowed tool "${toolName}" is duplicated`);
    }
    seen.add(toolName);

    const tool = getSalesforceTool(toolName);
    if (!tool?.endpoint) {
      throw new TypeError(`Salesforce service-account tool "${toolName}" is not endpoint-backed`);
    }
    return tool;
  }));
}

function endpointTypeToJsonSchema(
  type: SalesforceEndpointParam["type"],
): Record<string, unknown> {
  switch (type) {
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "string[]":
      return { type: "array", items: { type: "string" } };
    case "object":
      return { type: "object" };
    case "array":
      return { type: "array" };
    default:
      return { type: "string" };
  }
}

const CURATED_SOQL_RESTRICTIONS =
  "Custom queries must keep the default query's selected fields and object, may only filter or " +
  "sort by fields the default query already references, and must preserve the default query's " +
  "WHERE predicates (additional conditions can only be AND-ed). Functions, subqueries, and " +
  "side-effecting clauses are rejected.";

function buildToolInputSchema(endpoint: SalesforceEndpoint): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, definition] of Object.entries(endpoint.params ?? {})) {
    if (
      definition.in === "header" &&
      !(definition.required === true && definition.default === undefined)
    ) {
      continue;
    }
    const curatedSoql = key === "q" && definition.in === "query" &&
      typeof definition.default === "string";
    properties[key] = {
      ...endpointTypeToJsonSchema(definition.type),
      description: curatedSoql
        ? `${definition.description} ${CURATED_SOQL_RESTRICTIONS}`
        : definition.description,
      ...(definition.exposeDefault === true && definition.default !== undefined
        ? { default: definition.default }
        : {}),
    };
    if (definition.required === true) required.push(key);
  }

  for (const [key, definition] of Object.entries(endpoint.body ?? {})) {
    properties[key] = {
      ...endpointTypeToJsonSchema(definition.type),
      description: definition.description,
    };
    if (definition.required === true) required.push(key);
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function toToolDefinition(tool: IntegrationToolMeta): ToolDefinition {
  const name = getToolId(tool);
  if (!name || !tool.endpoint) {
    throw new TypeError("Salesforce service-account tools require endpoint-backed identifiers");
  }
  const readOnly = tool.requiresWrite !== true;
  const idempotent = ["GET", "PUT", "DELETE"].includes(tool.endpoint.method);
  return {
    name,
    description: tool.description,
    parameters: buildToolInputSchema(tool.endpoint),
    title: tool.name,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: tool.requiresWrite === true,
      idempotentHint: idempotent,
      openWorldHint: true,
    },
  };
}

function createRequestSignalScope(callerSignal: AbortSignal | undefined): RequestSignalScope {
  callerSignal?.throwIfAborted();
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(callerSignal?.reason);
  const timeout = setTimeout(() => {
    controller.abort(
      new DOMException(
        `Salesforce request timed out after ${INTEGRATION_REQUEST_TIMEOUT_MS} ms`,
        "TimeoutError",
      ),
    );
  }, INTEGRATION_REQUEST_TIMEOUT_MS);

  if (callerSignal) {
    callerSignal.addEventListener("abort", forwardAbort, { once: true });
    if (callerSignal.aborted) forwardAbort();
  }

  let disposed = false;
  return {
    signal: controller.signal,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", forwardAbort);
    },
  };
}

function missingCredentialsResult(missingEnvVars: SalesforceServiceAccountEnvVar[]): unknown {
  const names = missingEnvVars.length === 2
    ? `${missingEnvVars[0]} and ${missingEnvVars[1]}`
    : missingEnvVars.join(", ");
  return {
    error: "missing_credentials",
    integration: SALESFORCE_INTEGRATION,
    missingEnvVars,
    message: `Salesforce service account credentials are not configured. Set ${names}.`,
  };
}

function invalidLoginOriginResult(): unknown {
  return {
    error: "invalid_credentials",
    integration: SALESFORCE_INTEGRATION,
    message: `${LOGIN_URL_ENV} must be a Salesforce My Domain HTTPS origin.`,
  };
}

function authFailureResult(): unknown {
  return {
    error: "salesforce_auth_failed",
    integration: SALESFORCE_INTEGRATION,
    message: "Salesforce service account authentication failed.",
  };
}

function apiFailureResult(status?: number): unknown {
  return {
    error: status === 401 ? "invalid_credentials" : "salesforce_api_error",
    integration: SALESFORCE_INTEGRATION,
    ...(status === undefined ? {} : { status }),
    message: status === 401
      ? "Salesforce rejected the service account credential."
      : "Salesforce API request failed.",
  };
}

function tokenFailureResult(cause: unknown): unknown {
  if (cause instanceof SalesforceTokenFailure && cause.kind === "auth") {
    return authFailureResult();
  }
  return apiFailureResult(cause instanceof SalesforceTokenFailure ? cause.status : undefined);
}

function readCredential(name: SalesforceServiceAccountEnvVar): string | undefined {
  const value = getEnv(name);
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH
  ) {
    return undefined;
  }
  return value;
}

function parseOrigin(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.port.length > 0 ||
      url.pathname !== "/" ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

function parseLoginOrigin(value: string): string | undefined {
  const url = parseOrigin(value);
  if (!url || !url.hostname.endsWith(".my.salesforce.com")) return undefined;
  return url.origin;
}

function parseInstanceOrigin(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const url = parseOrigin(value);
  if (
    !url ||
    !url.hostname.endsWith(".salesforce.com") ||
    url.hostname === "login.salesforce.com" ||
    url.hostname === "test.salesforce.com"
  ) {
    return undefined;
  }
  return url.origin;
}

function resolveCredentials():
  | { status: "ok"; credentials: SalesforceCredentials }
  | { status: "missing"; result: unknown }
  | { status: "invalid"; result: unknown } {
  const clientId = readCredential(CLIENT_ID_ENV);
  const clientSecret = readCredential(CLIENT_SECRET_ENV);
  const rawLoginUrl = readCredential(LOGIN_URL_ENV);
  const missingEnvVars = [
    ...(clientId === undefined ? [CLIENT_ID_ENV] : []),
    ...(clientSecret === undefined ? [CLIENT_SECRET_ENV] : []),
    ...(rawLoginUrl === undefined ? [LOGIN_URL_ENV] : []),
  ];
  if (missingEnvVars.length > 0) {
    return { status: "missing", result: missingCredentialsResult(missingEnvVars) };
  }

  const loginOrigin = parseLoginOrigin(rawLoginUrl!);
  if (!loginOrigin) return { status: "invalid", result: invalidLoginOriginResult() };
  return {
    status: "ok",
    credentials: {
      clientId: clientId!,
      clientSecret: clientSecret!,
      loginOrigin,
    },
  };
}

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(parsed) || parsed > maxBytes) {
      void response.body?.cancel().catch(() => undefined);
      throw new RangeError("Salesforce response exceeds the response limit");
    }
  }
  const { text, truncated } = await readResponseTextPrefix(
    response,
    maxBytes + 1,
    signal,
    { fatalUtf8: true },
  );
  if (truncated || new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new RangeError("Salesforce response exceeds the response limit");
  }
  return text;
}

function parseJsonRecord(text: string): Record<string, unknown> | undefined {
  try {
    const snapshot = snapshotBoundedJsonValue(JSON.parse(text));
    return snapshot.success && isRecord(snapshot.value) ? snapshot.value : undefined;
  } catch {
    return undefined;
  }
}

function snapshotArguments(args: Record<string, unknown>): Record<string, unknown> {
  const snapshot = snapshotBoundedJsonValue(args);
  if (!snapshot.success || !isRecord(snapshot.value)) {
    throw new TypeError("Salesforce tool arguments must be a bounded JSON object");
  }
  return snapshot.value;
}

function credentialsMatch(
  cached: SalesforceTokenCache,
  credentials: SalesforceCredentials,
): boolean {
  return cached.clientId === credentials.clientId &&
    cached.clientSecret === credentials.clientSecret &&
    cached.loginOrigin === credentials.loginOrigin;
}

async function requestSalesforceToken(
  credentials: SalesforceCredentials,
  context: ToolExecutionContext | undefined,
  createOriginBoundFetch: OriginBoundFetchFactory,
): Promise<SalesforceToken> {
  const requestScope = createRequestSignalScope(context?.abortSignal);
  try {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    });
    const response = await createOriginBoundFetch(credentials.loginOrigin)(
      SALESFORCE_TOKEN_PATH,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: requestScope.signal,
        redirect: "error",
      },
    );
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      const isCredentialRejection = response.status === 400 || response.status === 401;
      throw new SalesforceTokenFailure(
        isCredentialRejection ? "auth" : "api",
        isCredentialRejection ? undefined : response.status,
      );
    }
    const data = parseJsonRecord(
      await readBoundedResponse(response, TOKEN_RESPONSE_LIMIT_BYTES, requestScope.signal),
    );
    const accessToken = data?.access_token;
    const instanceOrigin = parseInstanceOrigin(data?.instance_url);
    if (
      typeof accessToken !== "string" ||
      accessToken.length === 0 ||
      accessToken.length > MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH ||
      !instanceOrigin
    ) {
      throw new SalesforceTokenFailure("auth");
    }
    return { accessToken, instanceOrigin };
  } finally {
    requestScope.dispose();
  }
}

function isMissingRequiredInput(value: unknown): boolean {
  return value === undefined || value === null ||
    (typeof value === "string" && value.trim().length === 0);
}

function resolveEndpointValue(
  args: Record<string, unknown>,
  key: string,
  definition: SalesforceEndpointParam,
): unknown {
  const value = args[key];
  if (!definition.required && typeof value === "string" && value.trim().length === 0) {
    return definition.default;
  }
  return value === undefined ? definition.default : value;
}

function validateEndpointInputs(
  endpoint: SalesforceEndpoint,
  args: Record<string, unknown>,
): void {
  const missing: string[] = [];
  for (const [key, definition] of Object.entries(endpoint.params ?? {})) {
    const value = resolveEndpointValue(args, key, definition);
    if (
      definition.required === true &&
      definition.default === undefined &&
      isMissingRequiredInput(value)
    ) {
      missing.push(key);
      continue;
    }
    validateEndpointInputType(key, definition, value);
  }
  for (const [key, definition] of Object.entries(endpoint.body ?? {})) {
    const value = args[key] === undefined ? definition.default : args[key];
    if (
      definition.required === true &&
      definition.default === undefined &&
      isMissingRequiredInput(value)
    ) {
      missing.push(key);
      continue;
    }
    validateEndpointInputType(key, definition, value);
  }
  if (missing.length > 0) {
    throw new TypeError(`Missing required Salesforce tool input: ${missing.join(", ")}`);
  }
}

function validateEndpointInputType(
  key: string,
  definition: SalesforceEndpointInput,
  value: unknown,
): void {
  if (value === undefined) return;
  const valid = definition.type === "string"
    ? typeof value === "string"
    : definition.type === "number"
    ? typeof value === "number"
    : definition.type === "boolean"
    ? typeof value === "boolean"
    : definition.type === "string[]"
    ? Array.isArray(value) && value.every((entry) => typeof entry === "string")
    : definition.type === "object"
    ? isRecord(value)
    : definition.type === "array"
    ? Array.isArray(value)
    : false;
  if (!valid) {
    const expected = definition.type === "string[]" ? "string array" : definition.type;
    throw new TypeError(`Salesforce tool input "${key}" must be a ${expected}`);
  }
}

function maskSoqlStrings(query: string): string {
  let masked = "";
  let inString = false;
  for (let index = 0; index < query.length; index++) {
    const character = query[index]!;
    if (character === "\\" && inString && index + 1 < query.length) {
      masked += "  ";
      index++;
      continue;
    }
    if (character === "'" && inString && query[index + 1] === "'") {
      masked += "  ";
      index++;
      continue;
    }
    if (character === "'") {
      inString = !inString;
      masked += " ";
      continue;
    }
    masked += inString ? " " : character;
  }
  if (inString) throw new TypeError("Salesforce SOQL query contains an unterminated string");
  return masked;
}

function collapseSoqlWhitespace(value: string): string {
  let result = "";
  let pendingSpace = false;
  for (const character of value.trim()) {
    if (/\s/.test(character)) {
      pendingSpace = result.length > 0;
      continue;
    }
    if (pendingSpace) result += " ";
    result += character;
    pendingSpace = false;
  }
  return result;
}

function removeSoqlWhitespace(value: string): string {
  let result = "";
  for (const character of value) {
    if (!/\s/.test(character)) result += character;
  }
  return result;
}

function countSoqlCommas(value: string): number {
  let count = 0;
  for (const character of value) {
    if (character === ",") count++;
  }
  return count;
}

function hasExactSoqlShapeKeywords(value: string): boolean {
  const keywords = /\b(?:select|from)\b/gi;
  let count = 0;
  while (keywords.exec(value)) {
    count++;
    if (count > 2) return false;
  }
  return count === 2;
}

function normalizeSoqlProjection(value: string): string[] {
  return value.split(",").map((field) => collapseSoqlWhitespace(field).toLowerCase()).sort((a, b) =>
    a.localeCompare(b)
  );
}

function normalizeSoqlClause(value: string): string {
  return collapseSoqlWhitespace(value)
    .replace(/ ?(!=|<=|>=|<|>|=) ?/g, "$1")
    .toLowerCase();
}

function hasBalancedSoqlParentheses(masked: string): boolean {
  let depth = 0;
  for (const character of masked) {
    if (character === "(") depth++;
    else if (character === ")" && --depth < 0) return false;
  }
  return depth === 0;
}

function hasSoqlConjunctBoundaryBefore(masked: string, start: number): boolean {
  let cursor = start - 1;
  while (/\s/.test(masked[cursor] ?? "")) cursor--;
  while (masked[cursor] === "(") {
    cursor--;
    while (/\s/.test(masked[cursor] ?? "")) cursor--;
  }
  if (cursor < 0) return true;
  const tokenStart = cursor - 2;
  return tokenStart >= 0 && masked.slice(tokenStart, cursor + 1).toLowerCase() === "and" &&
    !/[a-z0-9_]/i.test(masked[tokenStart - 1] ?? "");
}

function hasSoqlConjunctBoundaryAfter(masked: string, end: number): boolean {
  let cursor = end;
  while (/\s/.test(masked[cursor] ?? "")) cursor++;
  while (masked[cursor] === ")") {
    cursor++;
    while (/\s/.test(masked[cursor] ?? "")) cursor++;
  }
  if (cursor >= masked.length) return true;
  return masked.slice(cursor, cursor + 3).toLowerCase() === "and" &&
    !/[a-z0-9_]/i.test(masked[cursor + 3] ?? "");
}

function hasRequiredSoqlConjunct(value: string, requiredPredicate: string): boolean {
  const masked = maskSoqlStrings(value);
  if (!hasBalancedSoqlParentheses(masked)) return false;
  let searchStart = 0;
  while (searchStart <= value.length - requiredPredicate.length) {
    const predicateStart = value.indexOf(requiredPredicate, searchStart);
    if (predicateStart === -1) return false;
    const predicateEnd = predicateStart + requiredPredicate.length;
    if (
      hasSoqlConjunctBoundaryBefore(masked, predicateStart) &&
      hasSoqlConjunctBoundaryAfter(masked, predicateEnd)
    ) {
      return true;
    }
    searchStart = predicateStart + 1;
  }
  return false;
}

/**
 * Locate a clause by keyword token boundaries (so `)ORDER BY` is recognized as
 * readily as ` ORDER BY `) and return the text between the start keyword and
 * the next terminating keyword.
 */
function extractSoqlClause(
  query: string,
  startPattern: RegExp,
  endPattern: RegExp,
): string | undefined {
  const start = startPattern.exec(query);
  if (!start) return undefined;
  const contentStart = start.index + start[0].length;
  endPattern.lastIndex = contentStart;
  const end = endPattern.exec(query);
  return query.slice(contentStart, end ? end.index : query.length);
}

const SOQL_WHERE_START_PATTERN = /\bwhere\b/i;
const SOQL_WHERE_END_PATTERN =
  /\b(?:order\s+by|group\s+by|with\s+data\s+category|limit|offset)\b/gi;

/**
 * Extract the raw WHERE clause from a SOQL query. Clause boundaries are
 * located in the string-masked query (masking is length-preserving), so
 * keyword matching tolerates any whitespace and quoted literals can never
 * open or close the clause; the clause text is then sliced from the original
 * query at those offsets so string values are preserved.
 */
function extractSoqlWhereClause(query: string): string | undefined {
  const masked = maskSoqlStrings(query);
  const start = SOQL_WHERE_START_PATTERN.exec(masked);
  if (!start) return undefined;
  const contentStart = start.index + start[0].length;
  SOQL_WHERE_END_PATTERN.lastIndex = contentStart;
  const end = SOQL_WHERE_END_PATTERN.exec(masked);
  return query.slice(contentStart, end ? end.index : query.length);
}

function collectSoqlClauseFields(query: string): Set<string> {
  const fields = new Set<string>();
  const masked = collapseSoqlWhitespace(maskSoqlStrings(query));
  for (const match of masked.matchAll(/[a-z][a-z0-9_.]*/gi)) {
    let operatorStart = match.index + match[0].length;
    while (operatorStart < masked.length && masked[operatorStart] === " ") operatorStart++;
    const remainder = masked.slice(operatorStart, operatorStart + 10).toLowerCase();
    if (
      remainder.startsWith("=") || remainder.startsWith("!=") ||
      remainder.startsWith("<") || remainder.startsWith(">") ||
      /^(?:like|not in|in|includes|excludes)(?:$|[ (])/.test(remainder)
    ) fields.add(match[0].toLowerCase());
  }
  for (const startPattern of [/\border\s+by\b/i, /\bgroup\s+by\b/i]) {
    const clause = extractSoqlClause(
      masked,
      startPattern,
      /\b(?:order\s+by|group\s+by|limit|offset|having|with)\b/gi,
    );
    if (!clause) continue;
    for (const entry of clause.split(",")) {
      const field = collapseSoqlWhitespace(entry).split(" ")[0];
      if (field && /^[a-z][a-z0-9_.]*$/i.test(field)) fields.add(field.toLowerCase());
    }
  }
  const dataCategoryClause = extractSoqlClause(
    masked,
    /\bwith\s+data\s+category\b/i,
    /\b(?:order\s+by|group\s+by|having|limit|offset|for|update)\b/gi,
  );
  if (dataCategoryClause) {
    const syntaxKeywords = new Set(["and", "at", "above", "below", "above_or_below"]);
    for (const match of dataCategoryClause.matchAll(/[a-z][a-z0-9_]*/gi)) {
      const identifier = match[0].toLowerCase();
      if (!syntaxKeywords.has(identifier)) fields.add(identifier);
    }
  }
  return fields;
}

function parseSoqlShape(query: string): { projection: string; object: string } | undefined {
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  if (!lower.startsWith("select ")) return undefined;
  const fromIndex = lower.indexOf(" from ", "select ".length);
  if (fromIndex === -1) return undefined;
  const projection = trimmed.slice("select ".length, fromIndex);
  const object = /^[a-z][a-z0-9_]*/i.exec(trimmed.slice(fromIndex + " from ".length))?.[0];
  return projection && object ? { projection, object } : undefined;
}

function validateCuratedSoql(tool: IntegrationToolMeta, args: Record<string, unknown>): void {
  if (getToolId(tool) === "salesforce__run_soql_query") return;
  const queryDefinition = tool.endpoint?.params?.q;
  if (
    queryDefinition?.in !== "query" ||
    typeof queryDefinition.default !== "string" ||
    typeof args.q !== "string" ||
    args.q.trim() === ""
  ) {
    return;
  }

  const expected = collapseSoqlWhitespace(maskSoqlStrings(queryDefinition.default));
  const supplied = collapseSoqlWhitespace(maskSoqlStrings(args.q));
  if (/\/\*|\*\/|--/.test(supplied)) {
    throw new TypeError("Salesforce curated tool SOQL does not allow comments");
  }
  if (/\bfor\s+(?:view|reference|update)\b/i.test(supplied)) {
    throw new TypeError("Salesforce curated tool SOQL does not allow side-effecting clauses");
  }
  if (/\bupdate\s+(?:tracking|viewstat)\b/i.test(supplied)) {
    throw new TypeError("Salesforce curated tool SOQL does not allow side-effecting clauses");
  }
  for (const match of supplied.matchAll(/[a-z][a-z0-9_]*\s*\(/gi)) {
    const token = match[0].replace("(", "").trim().toLowerCase();
    if (!["where", "and", "or", "not", "in", "includes", "excludes"].includes(token)) {
      throw new TypeError("Salesforce curated tool SOQL does not allow predicate functions");
    }
  }
  const expectedMatch = parseSoqlShape(expected);
  const suppliedMatch = parseSoqlShape(supplied);
  if (
    !expectedMatch ||
    !suppliedMatch ||
    !hasExactSoqlShapeKeywords(supplied) ||
    // Compare comma counts first so an attacker-sized projection is rejected
    // without materializing and sorting an unbounded field array.
    countSoqlCommas(suppliedMatch.projection) !== countSoqlCommas(expectedMatch.projection) ||
    normalizeSoqlProjection(suppliedMatch.projection).join(",") !==
      normalizeSoqlProjection(expectedMatch.projection).join(",") ||
    suppliedMatch.object.toLowerCase() !== expectedMatch.object.toLowerCase()
  ) {
    throw new TypeError(
      "Salesforce curated tool SOQL must preserve its selected fields and object",
    );
  }

  const allowedFields = new Set(
    normalizeSoqlProjection(expectedMatch.projection).map(removeSoqlWhitespace),
  );
  for (const field of collectSoqlClauseFields(queryDefinition.default)) allowedFields.add(field);
  for (const field of collectSoqlClauseFields(args.q)) {
    if (!allowedFields.has(field)) {
      throw new TypeError(
        "Salesforce curated tool SOQL may only filter or sort by authorized root-object fields",
      );
    }
  }

  const expectedWhere = extractSoqlWhereClause(queryDefinition.default);
  if (expectedWhere) {
    const suppliedWhere = extractSoqlWhereClause(args.q);
    const suppliedMaskedWhere = extractSoqlWhereClause(supplied);
    const requiredPredicate = normalizeSoqlClause(expectedWhere);
    const actualPredicate = suppliedWhere ? normalizeSoqlClause(suppliedWhere) : "";
    if (
      !hasRequiredSoqlConjunct(actualPredicate, requiredPredicate) ||
      !suppliedMaskedWhere || /\bor\b/i.test(suppliedMaskedWhere)
    ) {
      throw new TypeError("Salesforce curated tool SOQL must preserve its policy predicates");
    }
  }
}

function buildSalesforceRequest(
  endpoint: SalesforceEndpoint,
  args: Record<string, unknown>,
  token: SalesforceToken,
  signal: AbortSignal,
): Request {
  validateEndpointInputs(endpoint, args);
  const templatePrefix = "{{oauth.raw.instance_url}}";
  if (!endpoint.url.startsWith(`${templatePrefix}/`)) {
    throw new TypeError("Salesforce endpoint must use the instance URL template");
  }
  let rawUrl = `${token.instanceOrigin}${endpoint.url.slice(templatePrefix.length)}`;
  for (const [key, definition] of Object.entries(endpoint.params ?? {})) {
    if (definition.in !== "path") continue;
    const value = resolveEndpointValue(args, key, definition);
    if (isMissingRequiredInput(value)) {
      throw new TypeError(`Missing required Salesforce path input: ${key}`);
    }
    rawUrl = rawUrl.replace(`{${key}}`, encodeURIComponent(String(value)));
  }

  const url = new URL(rawUrl);
  if (url.origin !== token.instanceOrigin || rawUrl.includes("{{") || rawUrl.includes("{")) {
    throw new TypeError("Salesforce endpoint resolved outside the authorized instance origin");
  }
  for (const [key, definition] of Object.entries(endpoint.params ?? {})) {
    if (definition.in !== "query") continue;
    const value = resolveEndpointValue(args, key, definition);
    if (value === undefined) continue;
    const queryName = definition.queryName ?? key;
    if (Array.isArray(value)) {
      for (const entry of value) url.searchParams.append(queryName, String(entry));
    } else {
      url.searchParams.set(queryName, String(value));
    }
  }

  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${token.accessToken}`,
  });
  for (const [key, definition] of Object.entries(endpoint.params ?? {})) {
    if (definition.in !== "header") continue;
    const value = resolveEndpointValue(args, key, definition);
    if (value !== undefined) headers.set(definition.headerName ?? key, String(value));
  }

  let body: string | undefined;
  if (endpoint.body && ["POST", "PUT", "PATCH"].includes(endpoint.method)) {
    if (endpoint.bodyMode !== undefined) {
      throw new TypeError("Salesforce local tools do not support non-object request bodies");
    }
    const bodyObject: Record<string, unknown> = {};
    for (const [key, definition] of Object.entries(endpoint.body)) {
      const value = args[key] === undefined ? definition.default : args[key];
      if (value !== undefined) bodyObject[key] = value;
    }
    body = JSON.stringify(bodyObject);
    headers.set("Content-Type", endpoint.contentType ?? "application/json");
  }

  return new Request(url, {
    method: endpoint.method,
    headers,
    body,
    signal,
    redirect: "error",
  });
}

function applyResponseTransform(data: unknown, transform: string | undefined): unknown {
  if (!transform) return data;
  return transform.split(".").reduce<unknown>(
    (value, key) => isRecord(value) ? value[key] : undefined,
    data,
  );
}

async function executeSalesforceEndpoint(
  endpoint: SalesforceEndpoint,
  args: Record<string, unknown>,
  token: SalesforceToken,
  context: ToolExecutionContext | undefined,
  createOriginBoundFetch: OriginBoundFetchFactory,
): Promise<SalesforceEndpointResult> {
  const requestScope = createRequestSignalScope(context?.abortSignal);
  try {
    const request = buildSalesforceRequest(endpoint, args, token, requestScope.signal);
    const response = await createOriginBoundFetch(token.instanceOrigin)(request);
    if (response.status === 204) return { status: 204, result: { success: true } };

    const text = await readBoundedResponse(
      response,
      MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES,
      requestScope.signal,
    );
    if (!response.ok) return { status: response.status, result: undefined };

    const contentType = response.headers.get("content-type") ?? "";
    let result: unknown = text;
    if (contentType.includes("application/json")) {
      try {
        const snapshot = snapshotBoundedJsonValue(JSON.parse(text));
        if (!snapshot.success) throw new TypeError("Salesforce response is not bounded JSON");
        result = snapshot.value;
      } catch (cause) {
        throw new TypeError("Salesforce returned an invalid JSON response", { cause });
      }
    }
    return {
      status: response.status,
      result: applyResponseTransform(result, endpoint.response?.transform),
    };
  } finally {
    requestScope.dispose();
  }
}

/**
 * Create a local Salesforce service-account tool source.
 *
 * Materialize the returned source with `loadRemoteToolsFromSource` and pass
 * the result through an agent's `tools` field. The source reads credentials
 * lazily from the active project environment when a tool executes.
 */
export function createSalesforceServiceAccountToolSource(
  options: SalesforceServiceAccountToolSourceOptions,
): RemoteToolSource {
  return createSalesforceServiceAccountToolSourceWithTransport({
    ...options,
    createOriginBoundFetch: createOriginBoundOutboundFetch,
  });
}

/** @internal Test seam for the host-owned origin-bound transport. */
export function createSalesforceServiceAccountToolSourceWithTransport(
  options: SalesforceServiceAccountToolSourceTransportOptions,
): RemoteToolSource {
  const allowedTools = resolveAllowedTools(options.allowedTools);
  const definitions = Object.freeze(allowedTools.map(toToolDefinition));
  const toolByName = new Map(allowedTools.map((tool) => [getToolId(tool)!, tool]));
  let tokenCache: SalesforceTokenCache | undefined;

  const getToken = async (
    credentials: SalesforceCredentials,
    context: ToolExecutionContext | undefined,
  ): Promise<SalesforceToken> => {
    if (
      tokenCache &&
      tokenCache.expiresAt > Date.now() &&
      credentialsMatch(tokenCache, credentials)
    ) {
      return {
        accessToken: tokenCache.accessToken,
        instanceOrigin: tokenCache.instanceOrigin,
      };
    }
    const token = await requestSalesforceToken(
      credentials,
      context,
      options.createOriginBoundFetch,
    );
    tokenCache = {
      ...credentials,
      ...token,
      expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
    };
    return token;
  };

  return guardLocalCredentialSource(Object.freeze({
    id: "salesforce-service-account",
    async listTools(): Promise<ToolDefinition[]> {
      return [...definitions];
    },
    async executeTool(
      toolName: string,
      rawArgs: Record<string, unknown>,
      context?: ToolExecutionContext,
    ): Promise<unknown> {
      context?.abortSignal?.throwIfAborted();
      const tool = toolByName.get(toolName);
      if (!tool?.endpoint) {
        throw new TypeError(`Salesforce tool "${toolName}" is not allowed by this source`);
      }
      const args = snapshotArguments(rawArgs);
      validateEndpointInputs(tool.endpoint, args);
      validateCuratedSoql(tool, args);
      const credentialResolution = resolveCredentials();
      if (credentialResolution.status !== "ok") return credentialResolution.result;

      let token: SalesforceToken;
      try {
        token = await getToken(credentialResolution.credentials, context);
      } catch (cause) {
        context?.abortSignal?.throwIfAborted();
        return tokenFailureResult(cause);
      }

      let result: SalesforceEndpointResult;
      try {
        result = await executeSalesforceEndpoint(
          tool.endpoint,
          args,
          token,
          context,
          options.createOriginBoundFetch,
        );
      } catch {
        context?.abortSignal?.throwIfAborted();
        return apiFailureResult();
      }

      if (result.status === 401) {
        tokenCache = undefined;
        try {
          token = await getToken(credentialResolution.credentials, context);
        } catch (cause) {
          context?.abortSignal?.throwIfAborted();
          return tokenFailureResult(cause);
        }
        try {
          result = await executeSalesforceEndpoint(
            tool.endpoint,
            args,
            token,
            context,
            options.createOriginBoundFetch,
          );
        } catch {
          context?.abortSignal?.throwIfAborted();
          return apiFailureResult();
        }
      }

      return result.status >= 200 && result.status < 300
        ? result.result
        : apiFailureResult(result.status);
    },
  }));
}
