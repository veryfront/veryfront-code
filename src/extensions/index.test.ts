import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as authAlias from "veryfront/extensions/auth";
import * as bundlerAlias from "veryfront/extensions/bundler";
import * as cacheAlias from "veryfront/extensions/cache";
import * as compatAlias from "veryfront/extensions/compat";
import * as contentAlias from "veryfront/extensions/content";
import * as cssAlias from "veryfront/extensions/css";
import * as databaseAlias from "veryfront/extensions/database";
import * as extensionsAlias from "veryfront/extensions";
import * as observabilityAlias from "veryfront/extensions/observability";
import * as parserAlias from "veryfront/extensions/parser";
import * as sandboxAlias from "veryfront/extensions/sandbox";
import * as schemaAlias from "veryfront/extensions/schema";
import type {
  ExtensionTeardownContext,
  SandboxShellToolDefinition,
  SandboxShellToolExecutionContext as RootSandboxShellToolExecutionContext,
  SandboxShellToolMcpConfig as RootSandboxShellToolMcpConfig,
  SandboxShellToolType as RootSandboxShellToolType,
  SetupAllOptions,
  TeardownAllOptions,
} from "veryfront/extensions";
import type {
  SandboxShellToolExecutionContext,
  SandboxShellToolMcpConfig,
  SandboxShellToolType,
} from "veryfront/extensions/sandbox";
import type { JsonSchemaTypeName } from "veryfront/extensions/schema";
import * as bundlerDirect from "./bundler/index.ts";
import * as extensionsDirect from "./index.ts";
import * as observabilityDirect from "./observability/index.ts";
import * as sandboxDirect from "./sandbox/index.ts";

const ROOT_RUNTIME_EXPORTS: string[] = [
  "CIRCULAR_DEPENDENCY_ERROR",
  "EXTENSION_CONFLICT_ERROR",
  "EXTENSION_SETUP_TIMEOUT_ERROR",
  "EXTENSION_VALIDATION_ERROR",
  "ExtensionLoader",
  "MISSING_EXTENSION_ERROR",
  "SandboxShellToolsProviderName",
  "auditCapabilities",
  "detectConflicts",
  "discoverLocalExtensions",
  "discoverPackageExtensions",
  "discoverProjectExtensions",
  "formatCapabilities",
  "getRecommendation",
  "loadExtensionFactory",
  "mapToDenoPermissions",
  "mergeExtensions",
  "orchestrateExtensions",
  "parsePackageMetadata",
  "resolve",
  "tryResolve",
  "validateExtension",
];

describe("extensions public barrels", () => {
  it("keeps the root package alias aligned with its exact runtime surface", () => {
    assertEquals(Object.keys(extensionsAlias).toSorted(), ROOT_RUNTIME_EXPORTS);
    assertEquals(Object.keys(extensionsDirect).toSorted(), ROOT_RUNTIME_EXPORTS);

    const aliasRecord = extensionsAlias as Record<string, unknown>;
    const directRecord = extensionsDirect as Record<string, unknown>;
    for (const name of ROOT_RUNTIME_EXPORTS) {
      assertStrictEquals(aliasRecord[name], directRecord[name]);
    }
  });

  it("keeps category package aliases aligned with their direct barrels", () => {
    assertEquals(Object.keys(authAlias), []);
    assertEquals(Object.keys(cacheAlias), []);
    assertEquals(Object.keys(compatAlias), []);
    assertEquals(Object.keys(contentAlias), []);
    assertEquals(Object.keys(cssAlias), []);
    assertEquals(Object.keys(databaseAlias), []);
    assertEquals(Object.keys(parserAlias), []);
    assertEquals(Object.keys(schemaAlias), []);

    assertEquals(Object.keys(bundlerAlias).toSorted(), [
      "build",
      "context",
      "getBundler",
      "stop",
      "transform",
    ]);
    assertEquals(Object.keys(bundlerAlias).toSorted(), Object.keys(bundlerDirect).toSorted());

    assertEquals(Object.keys(observabilityAlias), ["NodeTelemetryProviderName"]);
    assertStrictEquals(
      observabilityAlias.NodeTelemetryProviderName,
      observabilityDirect.NodeTelemetryProviderName,
    );

    assertEquals(Object.keys(sandboxAlias), ["SandboxShellToolsProviderName"]);
    assertStrictEquals(
      sandboxAlias.SandboxShellToolsProviderName,
      sandboxDirect.SandboxShellToolsProviderName,
    );
  });

  it("exports lifecycle option types from the root package alias", () => {
    const setupOptions: SetupAllOptions = {
      setupTimeoutMs: 1,
      teardownTimeoutMs: 2,
    };
    const teardownOptions: TeardownAllOptions = { teardownTimeoutMs: 3 };
    const teardownContext: ExtensionTeardownContext = {
      phase: "shutdown",
      signal: new AbortController().signal,
    };

    assertEquals(setupOptions, { setupTimeoutMs: 1, teardownTimeoutMs: 2 });
    assertEquals(teardownOptions, { teardownTimeoutMs: 3 });
    assertEquals(teardownContext.phase, "shutdown");
  });

  it("keeps sandbox-owned tool boundary types available from both public barrels", () => {
    const toolType: SandboxShellToolType = "function";
    const context: SandboxShellToolExecutionContext = {
      abortSignal: new AbortController().signal,
      request_id: "request-1",
    };
    const mcp: SandboxShellToolMcpConfig = { enabled: true };

    const rootToolType: RootSandboxShellToolType = toolType;
    const rootContext: RootSandboxShellToolExecutionContext = context;
    const rootMcp: RootSandboxShellToolMcpConfig = mcp;

    assertEquals(rootToolType, "function");
    assertEquals(rootContext.request_id, "request-1");
    assertEquals(rootMcp.enabled, true);
  });

  it("keeps sandbox schema and MCP annotation reads precisely typed", () => {
    const definition: SandboxShellToolDefinition = {
      inputSchemaJson: { type: ["object", "null"] },
      mcp: { annotations: { readOnlyHint: true } },
    };

    const schemaType: JsonSchemaTypeName | JsonSchemaTypeName[] | undefined = definition
      .inputSchemaJson?.type;
    const readOnlyHint: boolean | undefined = definition.mcp?.annotations?.readOnlyHint;

    assertEquals(schemaType, ["object", "null"]);
    assertEquals(readOnlyHint, true);
  });
});
