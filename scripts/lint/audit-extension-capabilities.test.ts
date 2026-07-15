import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  auditExtensionCapabilities,
  type ExtensionCapabilityAuditInput,
} from "./audit-extension-capabilities.ts";
import { extractExtensionSourceMetadata } from "./extension-source-metadata.ts";

function input(
  overrides: Partial<ExtensionCapabilityAuditInput> = {},
): ExtensionCapabilityAuditInput {
  return {
    manifestPath: "extensions/ext-sandbox-shell-tools/deno.json",
    manifestCapabilities: [{ type: "sandbox:execute", tools: ["bash"] }],
    factoryCapabilities: [{ type: "sandbox:execute", tools: ["bash"] }],
    ...overrides,
  };
}

describe("auditExtensionCapabilities", () => {
  it("accepts matching manifest and factory capabilities", () => {
    assertEquals(auditExtensionCapabilities([input()]), []);
  });

  it("flags drift between manifest and factory capabilities", () => {
    const issues = auditExtensionCapabilities([
      input({
        factoryCapabilities: [],
      }),
    ]);

    assertEquals(issues.map((issue) => issue.message), [
      'extensions/ext-sandbox-shell-tools/deno.json veryfront.capabilities differs from factory capabilities: manifest [{"tools":["bash"],"type":"sandbox:execute"}]; factory []',
    ]);
  });

  it("requires sensitive extension capabilities", () => {
    const issues = auditExtensionCapabilities([
      input({
        manifestCapabilities: [],
        factoryCapabilities: [],
      }),
    ]);

    assertEquals(issues.map((issue) => issue.message), [
      'extensions/ext-sandbox-shell-tools/deno.json sensitive extension "sandbox execution" is missing capability {"tools":["bash"],"type":"sandbox:execute"}',
    ]);
  });

  it("requires scoped env keys for sensitive extensions", () => {
    const issues = auditExtensionCapabilities([
      input({
        manifestPath: "extensions/ext-cache-redis/deno.json",
        manifestCapabilities: [
          { type: "net:outbound", hosts: ["*"] },
          { type: "env:read", keys: ["REDIS_URL"] },
        ],
        factoryCapabilities: [
          { type: "net:outbound", hosts: ["*"] },
          { type: "env:read", keys: ["REDIS_URL"] },
        ],
      }),
    ]);

    assertEquals(issues.map((issue) => issue.message), [
      'extensions/ext-cache-redis/deno.json sensitive extension "Redis token cache" is missing capability {"keys":["REDIS_PASSWORD","REDIS_PREFIX","REDIS_URL"],"type":"env:read"}',
    ]);
  });

  it("requires MLflow export capabilities with scoped config env keys", () => {
    const manifestPath = "extensions/ext-eval-report-mlflow/deno.json";
    const allowedCapabilities = [
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
          "VERYFRONT_EVAL_MLFLOW_EXPORTER_ID",
        ],
      },
    ];

    assertEquals(
      auditExtensionCapabilities([
        input({
          manifestPath,
          manifestCapabilities: allowedCapabilities,
          factoryCapabilities: allowedCapabilities,
        }),
      ]),
      [],
    );

    const incompleteCapabilities = [
      { type: "net:outbound", hosts: ["*"] },
      {
        type: "env:read",
        keys: [
          "MLFLOW_TRACKING_URI",
        ],
      },
    ];
    const issues = auditExtensionCapabilities([
      input({
        manifestPath,
        manifestCapabilities: incompleteCapabilities,
        factoryCapabilities: incompleteCapabilities,
      }),
    ]);

    assertEquals(issues.map((issue) => issue.message), [
      'extensions/ext-eval-report-mlflow/deno.json sensitive extension "eval report MLflow export" is missing capability {"keys":["MLFLOW_ARTIFACTS_PORT","MLFLOW_ARTIFACTS_URI","MLFLOW_EXPERIMENT_NAME","MLFLOW_RUN_NAME","MLFLOW_TRACKING_PASSWORD","MLFLOW_TRACKING_TOKEN","MLFLOW_TRACKING_URI","MLFLOW_TRACKING_USERNAME","VERYFRONT_EVAL_MLFLOW_EXPORTER_ID"],"type":"env:read"}',
    ]);
  });
});

describe("extractExtensionSourceMetadata capabilities", () => {
  it("extracts literal factory capabilities from source without importing the extension module", () => {
    const metadata = extractExtensionSourceMetadata(`
      import "https://esm.sh/transient-package";
      const ext = () => ({
        capabilities: [
          { type: "net:outbound", hosts: ["esm.sh"] },
          {
            type: "env:read",
            keys: [
              "OTEL_EXPORTER_OTLP_ENDPOINT",
              "OTEL_TRACES_ENABLED",
            ],
          },
        ],
      });
    `);

    assertEquals(metadata.capabilities, [
      { type: "net:outbound", hosts: ["esm.sh"] },
      {
        type: "env:read",
        keys: [
          "OTEL_EXPORTER_OTLP_ENDPOINT",
          "OTEL_TRACES_ENABLED",
        ],
      },
    ]);
  });
});
