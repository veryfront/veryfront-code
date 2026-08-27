import { dirname, fromFileUrl, join } from "#std/path";
import {
  containsUnicodeControlOrLineSeparator,
  isWellFormedUnicode,
  MAX_CAPABILITY_CONTAINER_ENTRIES,
  MAX_CAPABILITY_KEY_CHARACTERS,
  MAX_CAPABILITY_METADATA_UTF16_CODE_UNITS,
  MAX_CAPABILITY_METADATA_UTF8_BYTES,
  MAX_CAPABILITY_NESTING_DEPTH,
  MAX_CAPABILITY_STRING_CHARACTERS,
  MAX_CAPABILITY_TYPE_CHARACTERS,
  MAX_CAPABILITY_VALUE_NODES,
  MAX_EXTENSION_CAPABILITIES,
  utf8ByteLength,
} from "../../src/extensions/metadata-policy.ts";
import {
  formatCapabilities as formatRuntimeCapabilityAudit,
  isSupportedDenoSystemReadApi,
  mapToDenoPermissions,
} from "../../src/extensions/capabilities.ts";
import {
  createExtensionMetadataWorkspaceBudget,
  type ExtensionMetadataWorkspaceBudget,
  extractExtensionSourceMetadataFromFile,
} from "./extension-source-metadata.ts";
import {
  assertSupportedExtensionImportMap,
  canonicalExtensionManifestPath,
  createExtensionManifestWorkspaceBudget,
  discoverExtensionManifestPaths,
  ExtensionManifestReadError,
  type ExtensionManifestWorkspaceBudget,
  readExtensionManifest,
  resolveExtensionManifestEntry,
} from "./extension-manifest-reader.ts";

export type Capability = { type: string; [key: string]: unknown };

export { MAX_CAPABILITY_NESTING_DEPTH, MAX_EXTENSION_CAPABILITIES };

export interface ExtensionCapabilityAuditInput {
  manifestPath: string;
  manifestName: unknown;
  manifestCapabilities: unknown;
  factoryCapabilities: unknown;
  sourceResolutionIssues?: string[];
}

export interface ExtensionCapabilityAuditIssue {
  manifestPath: string;
  message: string;
}

export interface ExtensionCapabilityAuditOptions {
  requireSensitivePolicySubjects?: boolean;
}

export interface SensitiveCapabilityPolicy {
  label: string;
  packageName: string;
  requiredCapabilities: Capability[];
  /** Require the complete declared capability surface to match exactly. */
  exactCapabilities?: boolean;
}

export const SENSITIVE_EXTENSION_CAPABILITY_POLICIES:
  SensitiveCapabilityPolicy[] = [
    {
      label: "sandbox execution",
      packageName: "@veryfront/ext-sandbox-shell-tools",
      requiredCapabilities: [{ type: "sandbox:execute", tools: ["bash"] }],
    },
    {
      label: "Redis token cache",
      packageName: "@veryfront/ext-cache-redis",
      requiredCapabilities: [
        { type: "net:outbound", hosts: ["*"] },
        {
          type: "env:read",
          keys: ["REDIS_PASSWORD", "REDIS_PREFIX", "REDIS_URL"],
        },
      ],
    },
    {
      label: "Redis distributed runtime",
      packageName: "@veryfront/ext-redis",
      requiredCapabilities: [
        { type: "net:outbound", hosts: ["*"] },
        {
          type: "env:read",
          keys: ["NODE_ENV", "REDIS_PASSWORD", "REDIS_URL", "REDIS_USERNAME"],
        },
      ],
    },
    {
      label: "native SQLite storage",
      packageName: "@veryfront/ext-db-sqlite",
      requiredCapabilities: [
        { type: "fs:read" },
        { type: "fs:write" },
      ],
    },
    {
      label: "document extraction",
      packageName: "@veryfront/ext-document-kreuzberg",
      requiredCapabilities: [
        { type: "fs:read" },
        // Native kreuzberg parsing runs in a `deno run` subprocess so a native
        // crash cannot take down the host runtime.
        { type: "process:spawn", commands: ["deno"] },
        // The subprocess grants itself --allow-env and --allow-ffi so the
        // napi-rs loader in @kreuzberg/node can resolve and load the native
        // binding. Declared so the child permission surface stays audited.
        { type: "env:read" },
        { type: "native:ffi" },
      ],
    },
    {
      label: "PurgeCSS CPU discovery",
      packageName: "@veryfront/ext-css-purgecss",
      requiredCapabilities: [{ type: "system:read", apis: ["cpus"] }],
      exactCapabilities: true,
    },
    {
      label: "OpenTelemetry observability",
      packageName: "@veryfront/ext-observability-opentelemetry",
      requiredCapabilities: [
        { type: "net:outbound", hosts: ["*"] },
        {
          type: "env:read",
          keys: [
            "OTEL_EXPORTER_OTLP_ENDPOINT",
            "OTEL_EXPORTER_OTLP_HEADERS",
            "OTEL_SERVICE_NAME",
            "OTEL_TRACES_ENABLED",
          ],
        },
      ],
    },
    {
      label: "Sentry observability",
      packageName: "@veryfront/ext-observability-sentry",
      requiredCapabilities: [
        { type: "net:outbound", hosts: ["*"] },
        {
          type: "env:read",
          keys: [
            "APP_ENVIRONMENT",
            "NODE_ENV",
            "OTEL_DEPLOYMENT_ENVIRONMENT",
            "OTEL_SERVICE_NAME",
            "OTEL_SERVICE_VERSION",
            "RELEASE_VERSION",
            "SENTRY_DSN",
            "SENTRY_ENVIRONMENT",
            "SENTRY_RELEASE",
            "SENTRY_SERVICE",
            "SENTRY_SERVICE_NAME",
            "VERYFRONT_ENV",
            "VERYFRONT_ENVIRONMENT",
            "VERYFRONT_VERSION",
            "npm_package_name",
            "npm_package_version",
          ],
        },
      ],
    },
    {
      label: "eval report HTTP export",
      packageName: "@veryfront/ext-eval-report-http",
      requiredCapabilities: [
        { type: "net:outbound", hosts: ["*"] },
        {
          type: "env:read",
          keys: [
            "VERYFRONT_EVAL_HTTP_EXPORTER_HEADERS",
            "VERYFRONT_EVAL_HTTP_EXPORTER_ID",
            "VERYFRONT_EVAL_HTTP_EXPORTER_TOKEN",
            "VERYFRONT_EVAL_HTTP_EXPORTER_URL",
          ],
        },
      ],
    },
    {
      label: "eval report MLflow export",
      packageName: "@veryfront/ext-eval-report-mlflow",
      requiredCapabilities: [
        { type: "net:outbound", hosts: ["*"] },
        {
          type: "env:read",
          keys: [
            "MLFLOW_ARTIFACTS_PORT",
            "MLFLOW_ARTIFACTS_URI",
            "MLFLOW_EXPERIMENT_NAME",
            "MLFLOW_RUN_NAME",
            "MLFLOW_TRACKING_PASSWORD",
            "MLFLOW_TRACKING_TOKEN",
            "MLFLOW_TRACKING_URI",
            "MLFLOW_TRACKING_USERNAME",
            "MLFLOW_OAUTH_TOKEN_URL",
            "MLFLOW_OAUTH_CLIENT_ID",
            "MLFLOW_OAUTH_CLIENT_SECRET",
            "MLFLOW_OAUTH_SCOPE",
            "MLFLOW_EXPORT_ARTIFACTS",
            "MLFLOW_REQUEST_TIMEOUT_MS",
            "MLFLOW_RETRY_ATTEMPTS",
            "MLFLOW_RETRY_DELAY_MS",
            "MLFLOW_RUN_URL_TEMPLATE",
          ],
        },
      ],
    },
  ];

const FORBIDDEN_ENV_READ_KEYS_BY_PACKAGE = new Map<string, string[]>([
  [
    "@veryfront/ext-eval-report-mlflow",
    ["VERYFRONT_EVAL_MLFLOW_EXPORTER_ID"],
  ],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const MAX_EXTENSION_PACKAGE_NAME_CHARACTERS = 214;
const EXTENSION_PACKAGE_NAME_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

function validateExtensionPackageName(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 &&
      value.length <= MAX_EXTENSION_PACKAGE_NAME_CHARACTERS &&
      value.trim() === value && EXTENSION_PACKAGE_NAME_PATTERN.test(value)
    ? value
    : undefined;
}

function compareDeterministically(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function expectedPackageNameForManifestPath(
  manifestPath: string,
): string | undefined {
  const match = /^extensions\/(ext-[a-z0-9][a-z0-9-]*)\/deno\.json$/.exec(
    manifestPath,
  );
  return match ? `@veryfront/${match[1]}` : undefined;
}

interface ValidatedCapabilities {
  values: Capability[];
  issues: string[];
}

interface CapabilityValidationBudget {
  nodes: number;
  entries: number;
  utf8Bytes: number;
  utf16CodeUnits: number;
}

function validateCapabilityJsonTree(
  field: string,
  root: unknown,
  budget: CapabilityValidationBudget,
): string | undefined {
  const pending: Array<{ value: unknown; depth: number }> = [{
    value: root,
    depth: 0,
  }];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const { value, depth } = pending.pop()!;
    budget.nodes += 1;
    if (budget.nodes > MAX_CAPABILITY_VALUE_NODES) {
      return `${field} exceeds ${MAX_CAPABILITY_VALUE_NODES} aggregate value nodes`;
    }
    if (depth > MAX_CAPABILITY_NESTING_DEPTH) {
      return `${field} exceeds maximum nesting depth ${MAX_CAPABILITY_NESTING_DEPTH}`;
    }
    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "string") {
      if (!isWellFormedUnicode(value)) {
        return `${field} contains a string without well-formed Unicode`;
      }
      if (containsUnicodeControlOrLineSeparator(value)) {
        return `${field} contains a string with Unicode control characters or line separators`;
      }
      if (value.length > MAX_CAPABILITY_STRING_CHARACTERS) {
        return `${field} contains a string longer than ${MAX_CAPABILITY_STRING_CHARACTERS} characters`;
      }
      budget.utf8Bytes += utf8ByteLength(value);
      budget.utf16CodeUnits += value.length;
      if (
        budget.utf8Bytes > MAX_CAPABILITY_METADATA_UTF8_BYTES ||
        budget.utf16CodeUnits > MAX_CAPABILITY_METADATA_UTF16_CODE_UNITS
      ) {
        return `${field} exceeds ${MAX_CAPABILITY_METADATA_UTF8_BYTES} aggregate UTF-8 bytes or ${MAX_CAPABILITY_METADATA_UTF16_CODE_UNITS} UTF-16 code units`;
      }
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return `${field} contains a non-finite number`;
      }
      continue;
    }
    if (typeof value !== "object") {
      return `${field} must contain only JSON-safe values`;
    }
    if (seen.has(value)) {
      return `${field} must be an unshared acyclic JSON tree`;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      budget.entries += value.length;
      if (budget.entries > MAX_CAPABILITY_CONTAINER_ENTRIES) {
        return `${field} exceeds ${MAX_CAPABILITY_CONTAINER_ENTRIES} aggregate properties and items`;
      }
      for (let index = value.length - 1; index >= 0; index -= 1) {
        if (!Object.hasOwn(value, index)) {
          return `${field} contains an array hole`;
        }
        pending.push({ value: value[index], depth: depth + 1 });
      }
      continue;
    }

    let prototype: object | null;
    let descriptors: Record<string, PropertyDescriptor>;
    let symbols: symbol[];
    try {
      prototype = Object.getPrototypeOf(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
      symbols = Object.getOwnPropertySymbols(value);
    } catch {
      return `${field} contains an uninspectable object`;
    }
    if (prototype !== Object.prototype && prototype !== null) {
      return `${field} contains a non-JSON object`;
    }
    if (symbols.length > 0) {
      return `${field} contains symbol properties`;
    }
    const entries = Object.entries(descriptors);
    budget.entries += entries.length;
    if (budget.entries > MAX_CAPABILITY_CONTAINER_ENTRIES) {
      return `${field} exceeds ${MAX_CAPABILITY_CONTAINER_ENTRIES} aggregate properties and items`;
    }
    for (const [key, descriptor] of entries) {
      if (key === "__proto__") {
        return `${field} must not declare __proto__`;
      }
      if (!isWellFormedUnicode(key)) {
        return `${field} contains a key without well-formed Unicode`;
      }
      if (containsUnicodeControlOrLineSeparator(key)) {
        return `${field} contains a key with Unicode control characters or line separators`;
      }
      if (key.length > MAX_CAPABILITY_KEY_CHARACTERS) {
        return `${field} contains a key longer than ${MAX_CAPABILITY_KEY_CHARACTERS} characters`;
      }
      budget.utf8Bytes += utf8ByteLength(key);
      budget.utf16CodeUnits += key.length;
      if (
        budget.utf8Bytes > MAX_CAPABILITY_METADATA_UTF8_BYTES ||
        budget.utf16CodeUnits > MAX_CAPABILITY_METADATA_UTF16_CODE_UNITS
      ) {
        return `${field} exceeds ${MAX_CAPABILITY_METADATA_UTF8_BYTES} aggregate UTF-8 bytes or ${MAX_CAPABILITY_METADATA_UTF16_CODE_UNITS} UTF-16 code units`;
      }
      if (!descriptor.enumerable || !("value" in descriptor)) {
        return `${field} contains a non-data or non-enumerable property`;
      }
      pending.push({ value: descriptor.value, depth: depth + 1 });
    }
  }
  return undefined;
}

const STRING_SCOPE_FIELD_BY_TYPE = new Map<string, string>([
  ["env:read", "keys"],
  ["fs:read", "paths"],
  ["fs:write", "paths"],
  ["net:outbound", "hosts"],
  ["process:spawn", "commands"],
  ["sandbox:execute", "tools"],
  ["system:read", "apis"],
]);
const ALLOWED_CAPABILITY_FIELDS_BY_TYPE = new Map<string, ReadonlySet<string>>([
  ["env:read", new Set(["type", "keys"])],
  ["fs:read", new Set(["type", "paths"])],
  ["fs:write", new Set(["type", "paths"])],
  ["native:ffi", new Set(["type"])],
  ["net:listen", new Set(["type", "host", "ports"])],
  ["net:outbound", new Set(["type", "hosts"])],
  ["process:spawn", new Set(["type", "commands"])],
  ["sandbox:execute", new Set(["type", "tools"])],
  ["system:read", new Set(["type", "apis"])],
]);

function containsUnsafePermissionScopeSyntax(value: string): boolean {
  return value.includes(",") || containsUnicodeControlOrLineSeparator(value);
}

function isCanonicalPermissionScopeString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    value.trim() === value && !containsUnsafePermissionScopeSyntax(value);
}

function isValidPermissionPort(value: string): boolean {
  return /^(?:[1-9]\d{0,4})$/.test(value) && Number(value) <= 65_535;
}

function isValidDnsOrIpv4Host(value: string): boolean {
  if (value.length > 253 || value.includes(":")) return false;
  const wildcardSubdomain = value.startsWith("*.");
  const labels = (wildcardSubdomain ? value.slice(2) : value).split(".");
  if (labels.some((label) => label.length === 0 || label.length > 63)) {
    return false;
  }
  if (labels.every((label) => /^\d+$/.test(label))) {
    if (wildcardSubdomain) return false;
    return labels.length === 4 &&
      labels.every((label) =>
        (label === "0" || !label.startsWith("0")) && Number(label) <= 255
      );
  }
  return labels.every((label) =>
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
  );
}

function isValidBracketedIpv6Host(value: string): boolean {
  if (!/^\[[0-9A-Fa-f:.]+\]$/.test(value)) return false;
  try {
    const parsed = new URL(`http://${value}/`);
    return parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]");
  } catch {
    return false;
  }
}

function isValidNetworkHost(
  value: string,
  allowPort: boolean,
): boolean {
  if (value.startsWith("[")) {
    const closeBracket = value.indexOf("]");
    if (closeBracket < 0) return false;
    const host = value.slice(0, closeBracket + 1);
    const suffix = value.slice(closeBracket + 1);
    if (!isValidBracketedIpv6Host(host)) return false;
    if (suffix.length === 0) return true;
    return allowPort && suffix.startsWith(":") &&
      isValidPermissionPort(suffix.slice(1));
  }
  const colon = value.indexOf(":");
  if (colon < 0) return isValidDnsOrIpv4Host(value);
  if (!allowPort || value.indexOf(":", colon + 1) >= 0) return false;
  return isValidDnsOrIpv4Host(value.slice(0, colon)) &&
    isValidPermissionPort(value.slice(colon + 1));
}

function validateKnownCapabilitySchema(
  field: string,
  capability: Capability,
): string[] {
  const issues: string[] = [];
  const allowedFields = ALLOWED_CAPABILITY_FIELDS_BY_TYPE.get(capability.type);
  if (allowedFields) {
    for (const key of Object.keys(capability).sort(compareDeterministically)) {
      if (!allowedFields.has(key)) {
        issues.push(
          `${field} contains unexpected field ${JSON.stringify(key)}`,
        );
      }
    }
  }
  const scopeField = STRING_SCOPE_FIELD_BY_TYPE.get(capability.type);
  if (capability.type === "system:read" && !Object.hasOwn(capability, "apis")) {
    issues.push(`${field}.apis must be a non-empty array`);
  }
  if (scopeField && Object.hasOwn(capability, scopeField)) {
    const scopes = capability[scopeField];
    if (!Array.isArray(scopes) || scopes.length === 0) {
      issues.push(`${field}.${scopeField} must be a non-empty array`);
    } else {
      for (let index = 0; index < scopes.length; index += 1) {
        const scope = scopes[index];
        if (typeof scope !== "string" || scope.trim().length === 0) {
          issues.push(
            `${field}.${scopeField}[${index}] must be a non-empty string`,
          );
        } else if (scope.trim() !== scope) {
          issues.push(
            `${field}.${scopeField}[${index}] must not have surrounding whitespace`,
          );
        } else if (!isWellFormedUnicode(scope)) {
          issues.push(
            `${field}.${scopeField}[${index}] must contain well-formed Unicode`,
          );
        } else if (containsUnsafePermissionScopeSyntax(scope)) {
          issues.push(
            `${field}.${scopeField}[${index}] must not contain commas or control characters, including Unicode C1 controls or line separators`,
          );
        }
      }
    }
  }

  if (capability.type === "env:read" && Array.isArray(capability.keys)) {
    for (let index = 0; index < capability.keys.length; index += 1) {
      const key = capability.keys[index];
      if (isCanonicalPermissionScopeString(key) && key.includes("=")) {
        issues.push(`${field}.keys[${index}] must not contain "="`);
      }
    }
  }
  if (capability.type === "system:read" && Array.isArray(capability.apis)) {
    for (let index = 0; index < capability.apis.length; index += 1) {
      const api = capability.apis[index];
      if (
        isCanonicalPermissionScopeString(api) &&
        !isSupportedDenoSystemReadApi(api)
      ) {
        issues.push(
          `${field}.apis[${index}] must be a supported read-only Deno 2.7.7 system API name`,
        );
      }
    }
  }
  if (
    capability.type === "net:outbound" && Array.isArray(capability.hosts)
  ) {
    const hosts = capability.hosts;
    if (hosts.includes("*") && (hosts.length !== 1 || hosts[0] !== "*")) {
      issues.push(`${field}.hosts must use "*" only as the sole host`);
    }
    for (let index = 0; index < hosts.length; index += 1) {
      const host = hosts[index];
      if (
        isCanonicalPermissionScopeString(host) && host !== "*" &&
        !isValidNetworkHost(host, true)
      ) {
        issues.push(
          `${field}.hosts[${index}] must be an ASCII DNS/IPv4 host or bracketed IPv6 host with an optional valid port`,
        );
      }
    }
  }

  if (capability.type === "net:listen") {
    const hasPorts = Object.hasOwn(capability, "ports");
    const hasHost = Object.hasOwn(capability, "host");
    if (hasPorts) {
      const ports = capability.ports;
      if (!Array.isArray(ports) || ports.length === 0) {
        issues.push(`${field}.ports must be a non-empty array`);
      } else {
        for (let index = 0; index < ports.length; index += 1) {
          const port = ports[index];
          const validNumber = typeof port === "number" &&
            Number.isInteger(port) && port >= 1 && port <= 65_535;
          const validString = typeof port === "string" &&
            /^(?:[1-9]\d{0,4})$/.test(port) && Number(port) <= 65_535;
          if (!validNumber && !validString) {
            issues.push(
              `${field}.ports[${index}] must be an integer from 1 through 65535`,
            );
          }
        }
      }
    }
    if (hasHost) {
      const host = capability.host;
      if (typeof host !== "string" || host.trim().length === 0) {
        issues.push(`${field}.host must be a non-empty string`);
      } else if (host.trim() !== host) {
        issues.push(`${field}.host must not have surrounding whitespace`);
      } else if (!isWellFormedUnicode(host)) {
        issues.push(`${field}.host must contain well-formed Unicode`);
      } else if (containsUnsafePermissionScopeSyntax(host)) {
        issues.push(
          `${field}.host must not contain commas or control characters, including Unicode C1 controls or line separators`,
        );
      } else if (!isValidNetworkHost(host, false)) {
        issues.push(
          `${field}.host must be an ASCII DNS/IPv4 host or bracketed IPv6 host without an embedded port`,
        );
      }
      if (!hasPorts) {
        issues.push(`${field}.host requires a non-empty ports array`);
      }
    }
  }
  return issues;
}

function validateCapabilityList(
  field: string,
  value: unknown,
): ValidatedCapabilities {
  if (!Array.isArray(value)) {
    return { values: [], issues: [`${field} must be an array`] };
  }
  if (value.length > MAX_EXTENSION_CAPABILITIES) {
    return {
      values: [],
      issues: [
        `${field} exceeds ${MAX_EXTENSION_CAPABILITIES} capabilities`,
      ],
    };
  }
  const values: Capability[] = [];
  const issues: string[] = [];
  const budget: CapabilityValidationBudget = {
    nodes: 0,
    entries: 0,
    utf8Bytes: 0,
    utf16CodeUnits: 0,
  };
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isRecord(entry)) {
      issues.push(`${field}[${index}] must be an object`);
      continue;
    }
    const structureIssue = validateCapabilityJsonTree(
      `${field}[${index}]`,
      entry,
      budget,
    );
    if (structureIssue) {
      issues.push(structureIssue);
    } else if (
      typeof entry.type !== "string" || entry.type.trim().length === 0
    ) {
      issues.push(`${field}[${index}].type must be a non-empty string`);
    } else if (entry.type.trim() !== entry.type) {
      issues.push(
        `${field}[${index}].type must not have surrounding whitespace`,
      );
    } else if (!isWellFormedUnicode(entry.type)) {
      issues.push(`${field}[${index}].type must contain well-formed Unicode`);
    } else if (containsUnicodeControlOrLineSeparator(entry.type)) {
      issues.push(
        `${field}[${index}].type must not contain Unicode control characters or line separators`,
      );
    } else if (entry.type.length > MAX_CAPABILITY_TYPE_CHARACTERS) {
      issues.push(
        `${field}[${index}].type must not exceed ${MAX_CAPABILITY_TYPE_CHARACTERS} characters`,
      );
    } else {
      const schemaIssues = validateKnownCapabilitySchema(
        `${field}[${index}]`,
        entry as Capability,
      );
      if (schemaIssues.length > 0) issues.push(...schemaIssues);
      else values.push(entry as Capability);
    }
  }
  if (issues.length === 0) {
    try {
      mapToDenoPermissions(values);
    } catch (error) {
      issues.push(
        `${field} cannot be serialized as Deno permissions: ${
          error instanceof Error ? error.message : "unknown validation failure"
        }`,
      );
    }
  }
  if (issues.length === 0) {
    try {
      formatRuntimeCapabilityAudit(values);
    } catch (error) {
      issues.push(
        `${field} cannot be formatted for capability audit: ${
          error instanceof Error ? error.message : "unknown validation failure"
        }`,
      );
    }
  }
  return { values, issues };
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue);
  }
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareDeterministically(left, right))
      .map(([key, entry]) => [key, canonicalizeJsonValue(entry)]),
  );
}

const CAPABILITY_SET_FIELD_BY_TYPE = new Map<string, string>([
  ["env:read", "keys"],
  ["fs:read", "paths"],
  ["fs:write", "paths"],
  ["net:listen", "ports"],
  ["net:outbound", "hosts"],
  ["process:spawn", "commands"],
  ["sandbox:execute", "tools"],
  ["system:read", "apis"],
]);

function normalizeCapability(capability: Capability): Capability {
  const normalized = canonicalizeJsonValue(capability) as Capability;
  const setField = CAPABILITY_SET_FIELD_BY_TYPE.get(capability.type);
  if (setField && Array.isArray(normalized[setField])) {
    normalized[setField] = normalized[setField].toSorted((left, right) =>
      compareDeterministically(JSON.stringify(left), JSON.stringify(right))
    );
  }
  if (capability.type === "net:listen" && Array.isArray(normalized.ports)) {
    normalized.ports = normalized.ports.map(String).toSorted((left, right) =>
      compareDeterministically(left, right)
    );
    if (normalized.host === undefined) normalized.host = "localhost";
  }
  return canonicalizeJsonValue(normalized) as Capability;
}

function normalizeCapabilities(capabilities: Capability[]): Capability[] {
  return capabilities
    .map(normalizeCapability)
    .toSorted((left, right) =>
      compareDeterministically(JSON.stringify(left), JSON.stringify(right))
    );
}

function formatCapabilities(capabilities: Capability[]): string {
  return JSON.stringify(normalizeCapabilities(capabilities));
}

function capabilitiesEqual(left: Capability[], right: Capability[]): boolean {
  return formatCapabilities(left) === formatCapabilities(right);
}

function fieldIncludes(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return expected.every((expectedEntry) =>
      actual.some((actualEntry) =>
        JSON.stringify(canonicalizeJsonValue(actualEntry)) ===
          JSON.stringify(canonicalizeJsonValue(expectedEntry))
      )
    );
  }
  return JSON.stringify(canonicalizeJsonValue(actual)) ===
    JSON.stringify(canonicalizeJsonValue(expected));
}

function capabilitySatisfies(
  actual: Capability,
  expected: Capability,
): boolean {
  if (actual.type !== expected.type) return false;

  for (const [key, expectedValue] of Object.entries(expected)) {
    if (key === "type") continue;
    if (!fieldIncludes(actual[key], expectedValue)) return false;
  }

  return true;
}

function hasRequiredCapability(
  capabilities: Capability[],
  requiredCapability: Capability,
): boolean {
  return capabilities.some((capability) =>
    capabilitySatisfies(capability, requiredCapability)
  );
}

export function auditExtensionCapabilities(
  inputs: ExtensionCapabilityAuditInput[],
  options: ExtensionCapabilityAuditOptions = {},
): ExtensionCapabilityAuditIssue[] {
  const issues: ExtensionCapabilityAuditIssue[] = [];
  const policyByPackage = new Map(
    SENSITIVE_EXTENSION_CAPABILITY_POLICIES.map((policy) => [
      policy.packageName,
      policy,
    ]),
  );
  const normalizedInputs = inputs.map((input) => ({
    ...input,
    manifestPath: canonicalExtensionManifestPath(input.manifestPath),
  }));
  const declaredPathsByPackage = new Map<string, string[]>();
  const validPathsByPackage = new Map<string, string[]>();
  for (const input of normalizedInputs) {
    const packageName = validateExtensionPackageName(input.manifestName);
    if (!packageName) continue;
    const paths = declaredPathsByPackage.get(packageName) ?? [];
    paths.push(input.manifestPath);
    declaredPathsByPackage.set(packageName, paths);
    if (
      expectedPackageNameForManifestPath(input.manifestPath) === packageName
    ) {
      const validPaths = validPathsByPackage.get(packageName) ?? [];
      validPaths.push(input.manifestPath);
      validPathsByPackage.set(packageName, validPaths);
    }
  }
  for (
    const [packageName, rawPaths] of [...declaredPathsByPackage].toSorted((
      [left],
      [right],
    ) => compareDeterministically(left, right))
  ) {
    if (rawPaths.length < 2) continue;
    const paths = rawPaths.toSorted(compareDeterministically);
    issues.push({
      manifestPath: paths[0]!,
      message: `${
        paths[0]
      } extension package name "${packageName}" is duplicated across ${
        paths.join(", ")
      }`,
    });
  }

  for (const input of normalizedInputs) {
    const packageName = validateExtensionPackageName(input.manifestName);
    if (!packageName) {
      issues.push({
        manifestPath: input.manifestPath,
        message: `${input.manifestPath} name must be a canonical package name`,
      });
    } else {
      const expectedPackageName = expectedPackageNameForManifestPath(
        input.manifestPath,
      );
      if (!expectedPackageName) {
        issues.push({
          manifestPath: input.manifestPath,
          message:
            `${input.manifestPath} must be a canonical extensions/ext-*/deno.json path`,
        });
      } else if (packageName !== expectedPackageName) {
        issues.push({
          manifestPath: input.manifestPath,
          message:
            `${input.manifestPath} name must be ${expectedPackageName}, received ${packageName}`,
        });
      }
    }
    const manifestResult = validateCapabilityList(
      "veryfront.capabilities",
      input.manifestCapabilities,
    );
    const factoryResult = validateCapabilityList(
      "factory capabilities",
      input.factoryCapabilities,
    );
    for (const issue of [...manifestResult.issues, ...factoryResult.issues]) {
      issues.push({
        manifestPath: input.manifestPath,
        message: `${input.manifestPath} ${issue}`,
      });
    }
    const manifestCapabilities = manifestResult.values;
    const factoryCapabilities = factoryResult.values;
    const sourceResolutionIssues = [
      ...new Set(
        input.sourceResolutionIssues ?? [],
      ),
    ].sort(compareDeterministically);
    for (const issue of sourceResolutionIssues) {
      issues.push({
        manifestPath: input.manifestPath,
        message:
          `${input.manifestPath} could not resolve factory capability metadata: ${issue}`,
      });
    }

    if (
      sourceResolutionIssues.length === 0 &&
      manifestResult.issues.length === 0 && factoryResult.issues.length === 0 &&
      !capabilitiesEqual(manifestCapabilities, factoryCapabilities)
    ) {
      issues.push({
        manifestPath: input.manifestPath,
        message:
          `${input.manifestPath} veryfront.capabilities differs from factory capabilities: manifest ${
            formatCapabilities(manifestCapabilities)
          }; factory ${formatCapabilities(factoryCapabilities)}`,
      });
    }

    const forbiddenEnvKeys = packageName
      ? FORBIDDEN_ENV_READ_KEYS_BY_PACKAGE.get(packageName) ?? []
      : [];
    for (const forbiddenKey of forbiddenEnvKeys) {
      for (
        const [label, capabilities] of [
          ["manifest", manifestCapabilities],
          ["factory", factoryCapabilities],
        ] as const
      ) {
        if (
          (label !== "factory" || sourceResolutionIssues.length === 0) &&
          capabilities.some((capability) =>
            capability.type === "env:read" &&
            Array.isArray(capability.keys) &&
            capability.keys.includes(forbiddenKey)
          )
        ) {
          issues.push({
            manifestPath: input.manifestPath,
            message:
              `${input.manifestPath} ${label} capabilities must not register forbidden env key ${forbiddenKey}`,
          });
        }
      }
    }

    const policy = packageName ? policyByPackage.get(packageName) : undefined;
    if (!policy || manifestResult.issues.length > 0) continue;

    if (policy.exactCapabilities) {
      if (
        !capabilitiesEqual(
          manifestCapabilities,
          policy.requiredCapabilities,
        )
      ) {
        issues.push({
          manifestPath: input.manifestPath,
          message:
            `${input.manifestPath} sensitive extension "${policy.label}" must declare exactly ${
              formatCapabilities(policy.requiredCapabilities)
            }; received ${formatCapabilities(manifestCapabilities)}`,
        });
      }
      continue;
    }

    for (const requiredCapability of policy.requiredCapabilities) {
      if (
        !hasRequiredCapability(
          manifestCapabilities,
          requiredCapability,
        )
      ) {
        issues.push({
          manifestPath: input.manifestPath,
          message:
            `${input.manifestPath} sensitive extension "${policy.label}" is missing capability ${
              JSON.stringify(normalizeCapability(requiredCapability))
            }`,
        });
      }
    }
  }

  if (options.requireSensitivePolicySubjects) {
    for (
      const policy of SENSITIVE_EXTENSION_CAPABILITY_POLICIES.toSorted((
        left,
        right,
      ) => compareDeterministically(left.packageName, right.packageName))
    ) {
      if (validPathsByPackage.has(policy.packageName)) continue;
      issues.push({
        manifestPath: "extensions",
        message:
          `extensions is missing required sensitive extension package ${policy.packageName}`,
      });
    }
  }

  return issues;
}

async function loadAuditInput(
  root: string,
  manifestPath: string,
  workspaceBudget: ExtensionMetadataWorkspaceBudget,
  manifestBudget: ExtensionManifestWorkspaceBudget,
): Promise<ExtensionCapabilityAuditInput> {
  const manifest = await readExtensionManifest(
    root,
    manifestPath,
    manifestBudget,
  );
  const veryfront = isRecord(manifest.veryfront) ? manifest.veryfront : {};
  const imports = manifest.imports;
  assertSupportedExtensionImportMap(manifestPath, manifest);
  const entryPath = resolveExtensionManifestEntry(manifestPath, manifest);
  let factoryCapabilities: Capability[] = [];
  let sourceResolutionIssues: string[] = [];
  try {
    const sourceMetadata = await extractExtensionSourceMetadataFromFile({
      workspaceRoot: root,
      entryPath: join(
        root,
        entryPath,
      ),
      importMapBaseDir: join(root, dirname(manifestPath)),
      imports: typeof imports === "object" && imports !== null &&
          !Array.isArray(imports)
        ? imports as Record<string, unknown>
        : {},
      workspaceBudget,
    });
    factoryCapabilities = sourceMetadata.capabilities;
    sourceResolutionIssues = sourceMetadata.capabilityResolutionIssues;
  } catch (error) {
    sourceResolutionIssues = [
      `[source-inspection-failed] ${
        error instanceof Error ? error.message : "unknown failure"
      }`,
    ];
  }

  return {
    manifestPath,
    manifestName: manifest.name,
    manifestCapabilities: veryfront.capabilities,
    factoryCapabilities,
    sourceResolutionIssues,
  };
}

export async function auditExtensionCapabilityWorkspace(
  root: string,
  options: ExtensionCapabilityAuditOptions = {
    requireSensitivePolicySubjects: true,
  },
): Promise<ExtensionCapabilityAuditIssue[]> {
  const discovery = await discoverExtensionManifestPaths(root);
  const workspaceBudget = createExtensionMetadataWorkspaceBudget();
  const manifestBudget = createExtensionManifestWorkspaceBudget();
  const loaded: Array<
    ExtensionCapabilityAuditInput | ExtensionCapabilityAuditIssue
  > = [];
  for (const manifestPath of discovery.manifestPaths) {
    try {
      loaded.push(
        await loadAuditInput(
          root,
          manifestPath,
          workspaceBudget,
          manifestBudget,
        ),
      );
    } catch (error) {
      const detail = error instanceof ExtensionManifestReadError
        ? error.message
        : "[manifest-read-failed] manifest could not be inspected";
      loaded.push({
        manifestPath,
        message: `${manifestPath} could not read extension manifest: ${detail}`,
      });
    }
  }
  const inputs: ExtensionCapabilityAuditInput[] = [];
  const issues: ExtensionCapabilityAuditIssue[] = discovery.issues.map((
    issue,
  ) => ({
    manifestPath: issue.manifestPath,
    message:
      `${issue.manifestPath} could not discover extension manifest: ${issue.detail}`,
  }));
  for (const entry of loaded) {
    if ("factoryCapabilities" in entry) inputs.push(entry);
    else issues.push(entry);
  }
  return [
    ...issues,
    ...auditExtensionCapabilities(inputs, {
      requireSensitivePolicySubjects: options.requireSensitivePolicySubjects ??
        true,
    }),
  ].sort((
    left,
    right,
  ) => compareDeterministically(left.message, right.message));
}

if (import.meta.main) {
  const root = fromFileUrl(new URL("../..", import.meta.url));
  const issues = await auditExtensionCapabilityWorkspace(root);
  if (issues.length === 0) {
    console.log("Extension capability metadata verified.");
    Deno.exit(0);
  }

  console.error(`${issues.length} extension capability issue(s):`);
  for (const issue of issues) {
    console.error(`  ${issue.message}`);
  }
  Deno.exit(1);
}
