import { fromFileUrl, join } from "#std/path";
import { extractExtensionSourceMetadata } from "./extension-source-metadata.ts";

export type Capability = { type: string; [key: string]: unknown };

export interface ExtensionCapabilityAuditInput {
  manifestPath: string;
  manifestCapabilities: Capability[];
  factoryCapabilities: Capability[];
}

export interface ExtensionCapabilityAuditIssue {
  manifestPath: string;
  message: string;
}

interface SensitiveCapabilityPolicy {
  label: string;
  manifestPath: string;
  requiredCapabilities: Capability[];
}

export const SENSITIVE_EXTENSION_CAPABILITY_POLICIES:
  SensitiveCapabilityPolicy[] = [
    {
      label: "sandbox execution",
      manifestPath: "extensions/ext-sandbox-shell-tools/deno.json",
      requiredCapabilities: [{ type: "sandbox:execute", tools: ["bash"] }],
    },
    {
      label: "Redis token cache",
      manifestPath: "extensions/ext-cache-redis/deno.json",
      requiredCapabilities: [
        { type: "net:outbound", hosts: ["*"] },
        {
          type: "env:read",
          keys: ["REDIS_PASSWORD", "REDIS_PREFIX", "REDIS_URL"],
        },
      ],
    },
    {
      label: "native SQLite storage",
      manifestPath: "extensions/ext-db-sqlite/deno.json",
      requiredCapabilities: [
        { type: "fs:read" },
        { type: "fs:write" },
      ],
    },
    {
      label: "document extraction",
      manifestPath: "extensions/ext-document-kreuzberg/deno.json",
      requiredCapabilities: [{ type: "fs:read" }],
    },
    {
      label: "OpenTelemetry observability",
      manifestPath: "extensions/ext-observability-opentelemetry/deno.json",
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
      label: "eval report HTTP export",
      manifestPath: "extensions/ext-eval-report-http/deno.json",
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
      manifestPath: "extensions/ext-eval-report-mlflow/deno.json",
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
          ],
        },
      ],
    },
  ];

const FORBIDDEN_ENV_READ_KEYS_BY_MANIFEST = new Map<string, string[]>([
  [
    "extensions/ext-eval-report-mlflow/deno.json",
    ["VERYFRONT_EVAL_MLFLOW_EXPORTER_ID"],
  ],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue).sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))
    );
  }
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJsonValue(entry)]),
  );
}

function normalizeCapability(capability: Capability): Capability {
  return sortJsonValue(capability) as Capability;
}

function normalizeCapabilities(capabilities: Capability[]): Capability[] {
  return capabilities
    .map(normalizeCapability)
    .toSorted((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))
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
        JSON.stringify(sortJsonValue(actualEntry)) ===
          JSON.stringify(sortJsonValue(expectedEntry))
      )
    );
  }
  return JSON.stringify(sortJsonValue(actual)) ===
    JSON.stringify(sortJsonValue(expected));
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
): ExtensionCapabilityAuditIssue[] {
  const issues: ExtensionCapabilityAuditIssue[] = [];
  const policyByManifest = new Map(
    SENSITIVE_EXTENSION_CAPABILITY_POLICIES.map((policy) => [
      policy.manifestPath,
      policy,
    ]),
  );

  for (const input of inputs) {
    if (
      !capabilitiesEqual(input.manifestCapabilities, input.factoryCapabilities)
    ) {
      issues.push({
        manifestPath: input.manifestPath,
        message:
          `${input.manifestPath} veryfront.capabilities differs from factory capabilities: manifest ${
            formatCapabilities(input.manifestCapabilities)
          }; factory ${formatCapabilities(input.factoryCapabilities)}`,
      });
    }

    const forbiddenEnvKeys = FORBIDDEN_ENV_READ_KEYS_BY_MANIFEST.get(
      input.manifestPath,
    ) ?? [];
    for (const forbiddenKey of forbiddenEnvKeys) {
      for (
        const [label, capabilities] of [
          ["manifest", input.manifestCapabilities],
          ["factory", input.factoryCapabilities],
        ] as const
      ) {
        if (
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

    const policy = policyByManifest.get(input.manifestPath);
    if (!policy) continue;

    for (const requiredCapability of policy.requiredCapabilities) {
      if (
        !hasRequiredCapability(
          input.manifestCapabilities,
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

  return issues;
}

async function extensionManifestPaths(root: string): Promise<string[]> {
  const extensionsDir = join(root, "extensions");
  const paths: string[] = [];
  for await (const entry of Deno.readDir(extensionsDir)) {
    if (!entry.isDirectory || !entry.name.startsWith("ext-")) continue;
    paths.push(join("extensions", entry.name, "deno.json"));
  }
  return paths.sort();
}

function capabilityList(value: unknown): Capability[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Capability =>
    isRecord(entry) && typeof entry.type === "string" && entry.type.length > 0
  );
}

async function loadAuditInput(
  root: string,
  manifestPath: string,
): Promise<ExtensionCapabilityAuditInput> {
  const manifest = JSON.parse(
    await Deno.readTextFile(join(root, manifestPath)),
  ) as Record<string, unknown>;
  const veryfront = (manifest.veryfront ?? {}) as Record<string, unknown>;
  const source = await Deno.readTextFile(
    join(root, manifestPath.replace(/deno\.json$/, "src/index.ts")),
  );
  const sourceMetadata = extractExtensionSourceMetadata(source);

  return {
    manifestPath,
    manifestCapabilities: capabilityList(veryfront.capabilities),
    factoryCapabilities: capabilityList(sourceMetadata.capabilities),
  };
}

async function auditWorkspace(
  root: string,
): Promise<ExtensionCapabilityAuditIssue[]> {
  const inputs = await Promise.all(
    (await extensionManifestPaths(root)).map((manifestPath) =>
      loadAuditInput(root, manifestPath)
    ),
  );
  return auditExtensionCapabilities(inputs);
}

if (import.meta.main) {
  const root = fromFileUrl(new URL("../..", import.meta.url));
  const issues = await auditWorkspace(root);
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
