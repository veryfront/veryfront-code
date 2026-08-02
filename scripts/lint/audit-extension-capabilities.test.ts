import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  auditExtensionCapabilities,
  auditExtensionCapabilityWorkspace,
  type ExtensionCapabilityAuditInput,
  MAX_CAPABILITY_NESTING_DEPTH,
  SENSITIVE_EXTENSION_CAPABILITY_POLICIES,
} from "./audit-extension-capabilities.ts";
import { extractExtensionSourceMetadata } from "./extension-source-metadata.ts";

function input(
  overrides: Partial<ExtensionCapabilityAuditInput> = {},
): ExtensionCapabilityAuditInput {
  const manifestPath = overrides.manifestPath ??
    "extensions/ext-sandbox-shell-tools/deno.json";
  const normalizedPath = manifestPath.replaceAll("\\", "/");
  const extensionDirectory = normalizedPath.split("/").at(-2) ??
    "ext-sandbox-shell-tools";
  return {
    manifestPath,
    manifestName: `@veryfront/${extensionDirectory}`,
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

  it("reports unresolved factory capability metadata without drift noise", () => {
    const issues = auditExtensionCapabilities([
      input({
        factoryCapabilities: [],
        sourceResolutionIssues: [
          "capabilities metadata contains a dynamic expression",
        ],
      }),
    ]);
    assertEquals(issues.map((issue) => issue.message), [
      "extensions/ext-sandbox-shell-tools/deno.json could not resolve factory capability metadata: capabilities metadata contains a dynamic expression",
    ]);
  });

  it("rejects malformed capability entries before normalization", () => {
    const issues = auditExtensionCapabilities([
      input({
        manifestCapabilities: [null, { type: " padded " }] as unknown,
      }),
    ]);
    assertEquals(issues.map((issue) => issue.message), [
      "extensions/ext-sandbox-shell-tools/deno.json veryfront.capabilities[0] must be an object",
      "extensions/ext-sandbox-shell-tools/deno.json veryfront.capabilities[1].type must not have surrounding whitespace",
    ]);
  });

  it("preserves order in extension-defined capability arrays", () => {
    const issues = auditExtensionCapabilities([
      input({
        manifestPath: "extensions/ext-custom/deno.json",
        manifestCapabilities: [{
          type: "custom",
          sequence: ["first", "second"],
        }],
        factoryCapabilities: [{
          type: "custom",
          sequence: ["second", "first"],
        }],
      }),
    ]);
    assertEquals(issues.map((issue) => issue.message), [
      'extensions/ext-custom/deno.json veryfront.capabilities differs from factory capabilities: manifest [{"sequence":["first","second"],"type":"custom"}]; factory [{"sequence":["second","first"],"type":"custom"}]',
    ]);
  });

  it("normalizes only schema-defined permission scope arrays as sets", () => {
    assertEquals(
      auditExtensionCapabilities([
        input({
          manifestPath: "extensions/ext-custom/deno.json",
          manifestCapabilities: [{
            type: "fs:read",
            paths: ["first", "second"],
          }],
          factoryCapabilities: [{
            type: "fs:read",
            paths: ["second", "first"],
          }],
        }),
      ]),
      [],
    );

    assertEquals(
      auditExtensionCapabilities([
        input({
          manifestPath: "extensions/ext-custom/deno.json",
          manifestCapabilities: [
            {
              type: "net:outbound",
              hosts: [
                "example.com:443",
                "*.example.com",
                "[2001:db8::1]:443",
                "192.0.2.1",
              ],
            },
            { type: "net:listen", ports: [8080] },
          ],
          factoryCapabilities: [
            {
              type: "net:outbound",
              hosts: [
                "192.0.2.1",
                "[2001:db8::1]:443",
                "*.example.com",
                "example.com:443",
              ],
            },
            { type: "net:listen", host: "localhost", ports: ["8080"] },
          ],
        }),
      ]),
      [],
    );

    const manifestDetails = Object.fromEntries([
      ["é", "composed"],
      ["e\u0301", "decomposed"],
    ]);
    const factoryDetails = Object.fromEntries([
      ["e\u0301", "decomposed"],
      ["é", "composed"],
    ]);
    assertEquals(
      auditExtensionCapabilities([
        input({
          manifestPath: "extensions/ext-custom/deno.json",
          manifestCapabilities: [{ type: "custom", details: manifestDetails }],
          factoryCapabilities: [{ type: "custom", details: factoryDetails }],
        }),
      ]),
      [],
    );
  });

  it("rejects malformed and deceptively empty permission scopes", () => {
    const malformed = [
      { type: "fs:read", paths: "./src" },
      { type: "env:read", keys: ["OK", ""] },
      { type: "net:listen", ports: [3000], host: "" },
      { type: "net:listen", host: "localhost" },
      { type: "process:spawn", commands: [42] },
      { type: "system:read", apis: ["cpus=all"] },
      { type: "fs:read", paths: ["./safe,/"] },
      { type: "env:read", keys: ["SAFE,SECRET"] },
      { type: "net:outbound", hosts: ["example.com,*"] },
      { type: "process:spawn", commands: ["safe,sh"] },
      { type: "net:listen", ports: [8080], host: "localhost,0.0.0.0" },
      { type: "env:read", keys: ["SAFE=SECRET"] },
      { type: "net:outbound", hosts: ["https://example.com"] },
      { type: "net:outbound", hosts: ["*", "example.com"] },
      { type: "net:listen", ports: [8080], host: "::1" },
    ];
    const malformedIssues = auditExtensionCapabilities([
      input({
        manifestPath: "extensions/ext-custom/deno.json",
        manifestCapabilities: malformed,
        factoryCapabilities: malformed,
      }),
    ]);
    assertEquals(malformedIssues.length, 30);
    assertEquals(
      malformedIssues.every((issue) =>
        (issue.message.includes("must be") ||
          issue.message.includes("requires a non-empty ports array") ||
          issue.message.includes("must not contain commas") ||
          issue.message.includes('must not contain "="') ||
          issue.message.includes(
            "must be a supported read-only Deno 2.7.7 system API name",
          ) ||
          issue.message.includes("must be an ASCII") ||
          issue.message.includes('must use "*" only')) &&
        !issue.message.includes("differs from factory")
      ),
      true,
    );

    const empty = [
      { type: "fs:read", paths: [] },
      { type: "env:read", keys: [] },
      { type: "net:outbound", hosts: [] },
      { type: "net:listen", ports: [] },
      { type: "system:read", apis: [] },
    ];
    const emptyIssues = auditExtensionCapabilities([
      input({
        manifestPath: "extensions/ext-custom/deno.json",
        manifestCapabilities: empty,
        factoryCapabilities: empty,
      }),
    ]);
    assertEquals(emptyIssues.length, 10);
    assertEquals(
      emptyIssues.every((issue) =>
        issue.message.includes("must be a non-empty array")
      ),
      true,
    );

    const misspelled = [
      { type: "fs:read", path: ["./safe"] },
      { type: "env:read", key: ["SAFE"] },
      { type: "net:outbound", host: ["example.com"] },
      { type: "process:spawn", command: ["safe"] },
      { type: "system:read", api: ["cpus"], apis: ["cpus"] },
      { type: "net:listen", address: "localhost", ports: [8080] },
      { type: "native:ffi", paths: ["./lib.so"] },
      { type: "sandbox:execute", commands: ["bash"] },
    ];
    const misspelledIssues = auditExtensionCapabilities([
      input({
        manifestPath: "extensions/ext-custom/deno.json",
        manifestCapabilities: misspelled,
        factoryCapabilities: misspelled,
      }),
    ]);
    assertEquals(misspelledIssues.length, 16);
    assertEquals(
      misspelledIssues.every((issue) =>
        issue.message.includes("contains unexpected field")
      ),
      true,
    );
  });

  it("rejects non-faithful or line-forging permission scope strings", () => {
    const malformed = [
      { type: "env:read", keys: ["SAFE\uD800KEY"] },
      { type: "fs:read", paths: ["./safe\uDC00path"] },
      { type: "env:read", keys: ["SAFE\u0085SECRET"] },
      { type: "fs:write", paths: ["./safe\u2029forged"] },
    ];
    const issues = auditExtensionCapabilities([
      input({
        manifestPath: "extensions/ext-custom/deno.json",
        manifestCapabilities: malformed,
        factoryCapabilities: malformed,
      }),
    ]);

    assertEquals(issues.length, 8);
    assertEquals(
      issues.every((issue) =>
        issue.message.includes("well-formed Unicode") ||
        issue.message.includes("control characters")
      ),
      true,
    );
  });

  it("rejects unsupported and mutating Deno system API names", () => {
    for (const api of ["foobar", "setPriority"]) {
      const issues = auditExtensionCapabilities([
        input({
          manifestPath: "extensions/ext-custom/deno.json",
          manifestCapabilities: [{ type: "system:read", apis: [api] }],
          factoryCapabilities: [{ type: "system:read", apis: [api] }],
        }),
      ]);

      assertEquals(issues.map((issue) => issue.message), [
        "extensions/ext-custom/deno.json veryfront.capabilities[0].apis[0] must be a supported read-only Deno 2.7.7 system API name",
        "extensions/ext-custom/deno.json factory capabilities[0].apis[0] must be a supported read-only Deno 2.7.7 system API name",
      ]);
    }
  });

  it("requires explicit system:read API scopes", () => {
    const issues = auditExtensionCapabilities([
      input({
        manifestPath: "extensions/ext-custom/deno.json",
        manifestCapabilities: [{ type: "system:read" }],
        factoryCapabilities: [{ type: "system:read" }],
      }),
    ]);

    assertEquals(issues.map((issue) => issue.message), [
      "extensions/ext-custom/deno.json veryfront.capabilities[0].apis must be a non-empty array",
      "extensions/ext-custom/deno.json factory capabilities[0].apis must be a non-empty array",
    ]);
  });

  it("rejects capability inventories that exceed the Deno argv budget", () => {
    const oversized = [{
      type: "env:read",
      keys: ["A", "B", "C"].map((prefix) => `${prefix}_${"x".repeat(3_000)}`),
    }];
    const issues = auditExtensionCapabilities([
      input({
        manifestPath: "extensions/ext-custom/deno.json",
        manifestCapabilities: oversized,
        factoryCapabilities: oversized,
      }),
    ]);

    assertEquals(issues.length, 2);
    assertEquals(
      issues.every((issue) =>
        issue.message.includes(
          "serialized Deno permission flags exceed the cross-platform budget",
        )
      ),
      true,
    );
  });

  it("rejects audit-forging custom metadata keys and strings", () => {
    for (
      const capability of [
        { type: "custom", details: "value\u0085FORGED" },
        { type: "custom", details: "value\u2028FORGED" },
        { type: "custom", details: "value\uD800FORGED" },
        { type: "custom", ["key\u2029FORGED"]: "value" },
      ]
    ) {
      const issues = auditExtensionCapabilities([
        input({
          manifestPath: "extensions/ext-custom/deno.json",
          manifestCapabilities: [capability],
          factoryCapabilities: [capability],
        }),
      ]);
      assertEquals(issues.length, 2);
      assertEquals(
        issues.every((issue) =>
          issue.message.includes("Unicode") ||
          issue.message.includes("well-formed")
        ),
        true,
      );
    }
  });

  it("bounds aggregate capability metadata size", () => {
    const oversized = [{
      type: "custom",
      details: Array.from({ length: 5 }, () => "x".repeat(7_000)),
    }];
    const issues = auditExtensionCapabilities([
      input({
        manifestPath: "extensions/ext-custom/deno.json",
        manifestCapabilities: oversized,
        factoryCapabilities: oversized,
      }),
    ]);

    assertEquals(issues.length, 2);
    assertEquals(
      issues.every((issue) =>
        issue.message.includes("exceeds 32768 aggregate UTF-8 bytes")
      ),
      true,
    );
  });

  it("keys sensitive policies by canonical package identity", () => {
    const renamedDirectory = auditExtensionCapabilities([
      input({
        manifestPath: "extensions/ext-renamed/deno.json",
        manifestName: "@veryfront/ext-cache-redis",
        manifestCapabilities: [],
        factoryCapabilities: [],
      }),
    ]);
    assertEquals(renamedDirectory.map((issue) => issue.message), [
      "extensions/ext-renamed/deno.json name must be @veryfront/ext-renamed, received @veryfront/ext-cache-redis",
      'extensions/ext-renamed/deno.json sensitive extension "Redis token cache" is missing capability {"hosts":["*"],"type":"net:outbound"}',
      'extensions/ext-renamed/deno.json sensitive extension "Redis token cache" is missing capability {"keys":["REDIS_PASSWORD","REDIS_PREFIX","REDIS_URL"],"type":"env:read"}',
    ]);

    const windowsPath = auditExtensionCapabilities([
      input({
        manifestPath: "extensions\\ext-sandbox-shell-tools\\deno.json",
        manifestName: "@veryfront/ext-sandbox-shell-tools",
        manifestCapabilities: [],
        factoryCapabilities: [],
      }),
    ]);
    assertEquals(windowsPath.map((issue) => issue.message), [
      'extensions/ext-sandbox-shell-tools/deno.json sensitive extension "sandbox execution" is missing capability {"tools":["bash"],"type":"sandbox:execute"}',
    ]);
  });

  it("rejects duplicate names and missing sensitive policy subjects", () => {
    const duplicate = auditExtensionCapabilities([
      input({
        manifestPath: "extensions/ext-one/deno.json",
        manifestName: "@veryfront/ext-duplicate",
        manifestCapabilities: [],
        factoryCapabilities: [],
      }),
      input({
        manifestPath: "extensions/ext-two/deno.json",
        manifestName: "@veryfront/ext-duplicate",
        manifestCapabilities: [],
        factoryCapabilities: [],
      }),
    ]);
    assertEquals(duplicate.map((issue) => issue.message), [
      'extensions/ext-one/deno.json extension package name "@veryfront/ext-duplicate" is duplicated across extensions/ext-one/deno.json, extensions/ext-two/deno.json',
      "extensions/ext-one/deno.json name must be @veryfront/ext-one, received @veryfront/ext-duplicate",
      "extensions/ext-two/deno.json name must be @veryfront/ext-two, received @veryfront/ext-duplicate",
    ]);

    const policyByPackage = new Map(
      SENSITIVE_EXTENSION_CAPABILITY_POLICIES.map((policy) => [
        policy.packageName,
        policy,
      ]),
    );
    const cachePolicy = policyByPackage.get("@veryfront/ext-cache-redis")!;
    const sentryPolicy = policyByPackage.get(
      "@veryfront/ext-observability-sentry",
    )!;
    const swapped = auditExtensionCapabilities([
      input({
        manifestPath: "extensions/ext-cache-redis/deno.json",
        manifestName: sentryPolicy.packageName,
        manifestCapabilities: sentryPolicy.requiredCapabilities,
        factoryCapabilities: sentryPolicy.requiredCapabilities,
      }),
      input({
        manifestPath: "extensions/ext-observability-sentry/deno.json",
        manifestName: cachePolicy.packageName,
        manifestCapabilities: cachePolicy.requiredCapabilities,
        factoryCapabilities: cachePolicy.requiredCapabilities,
      }),
    ]);
    assertEquals(swapped.map((issue) => issue.message), [
      "extensions/ext-cache-redis/deno.json name must be @veryfront/ext-cache-redis, received @veryfront/ext-observability-sentry",
      "extensions/ext-observability-sentry/deno.json name must be @veryfront/ext-observability-sentry, received @veryfront/ext-cache-redis",
    ]);

    const allPolicyInputs = SENSITIVE_EXTENSION_CAPABILITY_POLICIES.map((
      policy,
    ) => {
      const packageName = policy.packageName === "@veryfront/ext-cache-redis"
        ? "@veryfront/ext-cache-redis-renamed"
        : policy.packageName;
      return input({
        manifestPath: `extensions/${packageName.split("/").at(-1)}/deno.json`,
        manifestName: packageName,
        manifestCapabilities: policy.requiredCapabilities,
        factoryCapabilities: policy.requiredCapabilities,
      });
    });
    const missing = auditExtensionCapabilities(allPolicyInputs, {
      requireSensitivePolicySubjects: true,
    });
    assertEquals(missing.map((issue) => issue.message), [
      "extensions is missing required sensitive extension package @veryfront/ext-cache-redis",
    ]);

    const sentryMissing = auditExtensionCapabilities([
      input({
        manifestPath: "extensions/ext-observability-sentry/deno.json",
        manifestName: "@veryfront/ext-observability-sentry",
        manifestCapabilities: [],
        factoryCapabilities: [],
      }),
    ]);
    assertEquals(sentryMissing.length, 2);
    assertEquals(
      sentryMissing.every((issue) =>
        issue.message.includes('sensitive extension "Sentry observability"')
      ),
      true,
    );
  });

  it("bounds capability trees before canonicalization", () => {
    let nested: unknown = "leaf";
    for (let depth = 0; depth <= MAX_CAPABILITY_NESTING_DEPTH; depth += 1) {
      nested = { nested };
    }
    const issues = auditExtensionCapabilities([
      input({
        manifestPath: "extensions/ext-custom/deno.json",
        manifestCapabilities: [{ type: "custom", config: nested }],
        factoryCapabilities: [{ type: "custom" }],
      }),
    ]);
    assertEquals(issues.map((issue) => issue.message), [
      `extensions/ext-custom/deno.json veryfront.capabilities[0] exceeds maximum nesting depth ${MAX_CAPABILITY_NESTING_DEPTH}`,
    ]);

    const nonFinite = auditExtensionCapabilities([
      input({
        manifestPath: "extensions/ext-custom/deno.json",
        manifestCapabilities: [{ type: "custom", weight: Infinity }],
        factoryCapabilities: [{ type: "custom" }],
      }),
    ]);
    assertEquals(nonFinite.map((issue) => issue.message), [
      "extensions/ext-custom/deno.json veryfront.capabilities[0] contains a non-finite number",
    ]);
  });

  it("normalizes malformed manifest failures without absolute paths", async () => {
    const root = await Deno.makeTempDir();
    try {
      const extensionDir = `${root}/extensions/ext-static`;
      await Deno.mkdir(extensionDir, { recursive: true });
      await Deno.writeTextFile(`${extensionDir}/deno.json`, "{");
      const issues = await auditExtensionCapabilityWorkspace(root, {
        requireSensitivePolicySubjects: false,
      });
      assertEquals(issues.length, 1);
      assertEquals(
        issues[0]?.message,
        "extensions/ext-static/deno.json could not read extension manifest: [manifest-invalid-json] extensions/ext-static/deno.json: file is not valid JSON",
      );
      assertEquals(issues[0]?.message.includes(root), false);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("audits object-form root exports and rejects unsupported import maps", async () => {
    for (
      const unsupported of [
        undefined,
        { scopes: { "./src/": { dep: "./src/runtime.ts" } } },
        { importMap: "./import-map.json" },
        { imports: { "./src/dependency.ts": "./src/runtime.ts" } },
        { imports: { dependency: "./%2e%2e/runtime.ts" } },
      ]
    ) {
      const root = await Deno.makeTempDir();
      try {
        const extensionDir = `${root}/extensions/ext-static`;
        await Deno.mkdir(`${extensionDir}/src`, { recursive: true });
        await Deno.writeTextFile(
          `${extensionDir}/deno.json`,
          JSON.stringify({
            name: "@veryfront/ext-static",
            exports: { ".": "./src/runtime.ts", "./other": "./src/index.ts" },
            imports: {},
            ...(unsupported ?? {}),
            veryfront: {
              contracts: {},
              capabilities: [{ type: "fs:write" }],
            },
          }),
        );
        await Deno.writeTextFile(
          `${extensionDir}/src/index.ts`,
          `export default () => ({ contracts: {}, capabilities: [{ type: "fs:read" }] });`,
        );
        await Deno.writeTextFile(
          `${extensionDir}/src/runtime.ts`,
          `export default () => ({ contracts: {}, capabilities: [{ type: "fs:write" }] });`,
        );
        const issues = await auditExtensionCapabilityWorkspace(root, {
          requireSensitivePolicySubjects: false,
        });
        if (unsupported === undefined) assertEquals(issues, []);
        else {
          assertEquals(issues.length, 1);
          assertEquals(
            issues[0]?.message.includes("[manifest-invalid-import-map]"),
            true,
          );
        }
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    }
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

  it("preserves subset matching for non-fixed sensitive policies", () => {
    const capabilities = [
      { type: "net:outbound", hosts: ["*"] },
      {
        type: "env:read",
        keys: ["REDIS_PASSWORD", "REDIS_PREFIX", "REDIS_URL"],
      },
      { type: "fs:read", paths: ["./certificates"] },
    ];
    assertEquals(
      auditExtensionCapabilities([
        input({
          manifestPath: "extensions/ext-cache-redis/deno.json",
          manifestCapabilities: capabilities,
          factoryCapabilities: capabilities,
        }),
      ]),
      [],
    );
  });

  it("requires the scoped PurgeCSS CPU discovery capability", () => {
    const manifestPath = "extensions/ext-css-purgecss/deno.json";
    const exactCapabilities = [{ type: "system:read", apis: ["cpus"] }];
    assertEquals(
      auditExtensionCapabilities([
        input({
          manifestPath,
          manifestCapabilities: exactCapabilities,
          factoryCapabilities: exactCapabilities,
        }),
      ]),
      [],
    );
    const issues = auditExtensionCapabilities([
      input({
        manifestPath,
        manifestCapabilities: [],
        factoryCapabilities: [],
      }),
    ]);

    assertEquals(issues.map((issue) => issue.message), [
      'extensions/ext-css-purgecss/deno.json sensitive extension "PurgeCSS CPU discovery" must declare exactly [{"apis":["cpus"],"type":"system:read"}]; received []',
    ]);
  });

  it("rejects broader PurgeCSS capability surfaces", () => {
    const manifestPath = "extensions/ext-css-purgecss/deno.json";
    for (
      const capabilities of [
        [{ type: "system:read", apis: ["cpus", "hostname"] }],
        [
          { type: "system:read", apis: ["cpus"] },
          { type: "net:outbound", hosts: ["*"] },
        ],
      ]
    ) {
      const issues = auditExtensionCapabilities([
        input({
          manifestPath,
          manifestCapabilities: capabilities,
          factoryCapabilities: capabilities,
        }),
      ]);
      assertEquals(issues.length, 1);
      assertEquals(
        issues[0]?.message.startsWith(
          'extensions/ext-css-purgecss/deno.json sensitive extension "PurgeCSS CPU discovery" must declare exactly [{"apis":["cpus"],"type":"system:read"}]; received ',
        ),
        true,
      );
    }
  });

  it("requires MLflow export capabilities and forbids the exporter-id env key", () => {
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

    // The exporter id is fixed (see #2918), so reading VERYFRONT_EVAL_MLFLOW_EXPORTER_ID
    // is forbidden — registering it must be flagged, and the required scoped keys
    // (including MLFLOW_ARTIFACTS_PORT) are still reported as missing.
    const forbiddenCapabilities = [
      { type: "net:outbound", hosts: ["*"] },
      {
        type: "env:read",
        keys: [
          "MLFLOW_TRACKING_URI",
          "VERYFRONT_EVAL_MLFLOW_EXPORTER_ID",
        ],
      },
    ];
    const issues = auditExtensionCapabilities([
      input({
        manifestPath,
        manifestCapabilities: forbiddenCapabilities,
        factoryCapabilities: forbiddenCapabilities,
      }),
    ]);

    assertEquals(issues.map((issue) => issue.message), [
      "extensions/ext-eval-report-mlflow/deno.json manifest capabilities must not register forbidden env key VERYFRONT_EVAL_MLFLOW_EXPORTER_ID",
      "extensions/ext-eval-report-mlflow/deno.json factory capabilities must not register forbidden env key VERYFRONT_EVAL_MLFLOW_EXPORTER_ID",
      'extensions/ext-eval-report-mlflow/deno.json sensitive extension "eval report MLflow export" is missing capability {"keys":["MLFLOW_ARTIFACTS_PORT","MLFLOW_ARTIFACTS_URI","MLFLOW_EXPERIMENT_NAME","MLFLOW_EXPORT_ARTIFACTS","MLFLOW_OAUTH_CLIENT_ID","MLFLOW_OAUTH_CLIENT_SECRET","MLFLOW_OAUTH_SCOPE","MLFLOW_OAUTH_TOKEN_URL","MLFLOW_REQUEST_TIMEOUT_MS","MLFLOW_RETRY_ATTEMPTS","MLFLOW_RETRY_DELAY_MS","MLFLOW_RUN_NAME","MLFLOW_RUN_URL_TEMPLATE","MLFLOW_TRACKING_PASSWORD","MLFLOW_TRACKING_TOKEN","MLFLOW_TRACKING_URI","MLFLOW_TRACKING_USERNAME"],"type":"env:read"}',
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
      export default ext;
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
    assertEquals(metadata.capabilityResolutionIssues, []);
  });

  it("selects the exported factory and fails closed on dynamic capability shapes", () => {
    const decoys = extractExtensionSourceMetadata(`
      interface Decoy { capabilities: [{ type: "type-decoy" }] }
      const regex = /capabilities: [{ type: "regex-decoy" }]/;
      const template = \`capabilities: [{ type: "template-decoy" }]\`;
      export default () => ({
        name: "ext-real",
        version: "1.0.0",
        capabilities: [{ type: "net:outbound", hosts: ["example.com"] }],
      });
    `);
    assertEquals(decoys.capabilities, [
      { type: "net:outbound", hosts: ["example.com"] },
    ]);
    assertEquals(decoys.capabilityResolutionIssues, []);

    const aliased = extractExtensionSourceMetadata(`
      const capabilities = [{ type: "fs:read" }];
      const alias = capabilities;
      alias.push({ type: "fs:write" });
      export default () => ({ capabilities });
    `);
    assertEquals(aliased.capabilities, []);
    assertEquals(
      aliased.capabilityResolutionIssues.some((issue) =>
        issue.includes("literal metadata contains capabilities")
      ),
      true,
    );

    const spread = extractExtensionSourceMetadata(`
      const injected = [{ type: "fs:write" }];
      export default () => ({
        name: "ext-spread",
        version: "1.0.0",
        capabilities: [{ type: "fs:read" }, ...injected],
      });
    `);
    assertEquals(spread.capabilities, []);
    assertEquals(
      spread.capabilityResolutionIssues.some((issue) =>
        issue.includes("hole or spread")
      ),
      true,
    );

    const descriptorSpread = extractExtensionSourceMetadata(`
      const override = { capabilities: [{ type: "fs:write" }] };
      export default () => ({
        name: "ext-override",
        version: "1.0.0",
        capabilities: [{ type: "fs:read" }],
        ...override,
      });
    `);
    assertEquals(descriptorSpread.capabilities, []);
    assertEquals(
      descriptorSpread.capabilityResolutionIssues.some((issue) =>
        issue.includes("must not use spreads")
      ),
      true,
    );

    const parameterAlias = extractExtensionSourceMetadata(`
      const capabilities = [{ type: "fs:read" }];
      export default (capabilities = [{ type: "fs:write" }]) => ({
        capabilities,
      });
    `);
    assertEquals(parameterAlias.capabilities, []);
    assertEquals(
      parameterAlias.capabilityResolutionIssues.some((issue) =>
        issue.includes("literal metadata contains capabilities")
      ),
      true,
    );

    const prototypeMutation = extractExtensionSourceMetadata(`
      export default () => ({
        contracts: {},
        capabilities: [{
          type: "fs:read",
          __proto__: { paths: ["/secret"] },
        }],
      });
    `);
    assertEquals(prototypeMutation.capabilities, []);
    assertEquals(
      prototypeMutation.capabilityResolutionIssues.some((issue) =>
        issue.includes("must not declare __proto__")
      ),
      true,
    );
  });
});
