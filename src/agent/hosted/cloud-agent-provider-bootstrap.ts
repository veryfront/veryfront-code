/** Default provider bootstrap (schema / auth / telemetry / bash) for the cloud agent service. */
import type { AgentServiceSandboxToolsOptions } from "#veryfront/sandbox";
import { register, tryResolve } from "#veryfront/extensions/contracts.ts";
import { MISSING_EXTENSION_ERROR } from "#veryfront/extensions/errors.ts";
import {
  importFirstPartyExtensionModule,
  isMissingFirstPartyExtensionModule,
} from "#veryfront/extensions/first-party-import.ts";
import type { AuthProvider } from "#veryfront/extensions/auth/index.ts";
import type { SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import {
  type NodeTelemetryProvider,
  NodeTelemetryProviderName,
} from "#veryfront/extensions/observability/index.ts";
import {
  type SandboxShellToolsProvider,
  SandboxShellToolsProviderName,
} from "#veryfront/extensions/sandbox/index.ts";
import { getRuntimeAgentSourceContextSchema } from "../runtime/agent-invocation-contract.ts";
import {
  type HostedRuntimeSourceIdentity,
  snapshotHostedRuntimeSourceIdentity,
} from "./runtime-source-binding.ts";
import type { CreateNodeAgentServiceRuntimeInfrastructureOptions } from "../service/node-runtime-infrastructure.ts";
import type { RunAgentServiceMainOptions } from "../service/bootstrap.ts";
import type { AgentServiceMcpServerConfig } from "../service/mcp-server-config.ts";
import type { ProjectAgentRuntimeAgentSource } from "../project/agent-runtime.ts";
import {
  type AgentServicePathOption,
  resolveEnvironment,
  resolveServiceName,
} from "./cloud-agent-paths.ts";

type SandboxShellToolsExtensionModule = {
  createBashSandboxShellToolsProvider: AgentServiceSandboxToolsOptions["createBashTool"];
};

type AuthJwtExtensionModule = {
  createAuthProvider: (options?: Record<string, unknown>) => AuthProvider;
};

type ZeroArgumentConstructor<T> = new () => T;

const OPEN_TELEMETRY_EXTENSION_PACKAGE = "@veryfront/ext-observability-opentelemetry";

function isMissingOpenTelemetryExtension(error: unknown): boolean {
  return isMissingFirstPartyExtensionModule(error, [
    OPEN_TELEMETRY_EXTENSION_PACKAGE,
  ]);
}

function isConstructor<T>(
  value: unknown,
): value is ZeroArgumentConstructor<T> {
  if (typeof value !== "function") return false;
  try {
    Reflect.construct(Object, [], value);
    return true;
  } catch {
    return false;
  }
}

function resolveOptionalOpenTelemetryProviderConstructor(
  extensionModule: unknown,
): ZeroArgumentConstructor<NodeTelemetryProvider> | null {
  if (extensionModule === null) return null;
  if (
    typeof extensionModule !== "object" &&
    typeof extensionModule !== "function"
  ) {
    throw new TypeError(
      `Invalid ${OPEN_TELEMETRY_EXTENSION_PACKAGE} module: expected a module namespace`,
    );
  }

  let candidate: unknown;
  try {
    candidate = (extensionModule as Record<string, unknown>)
      .OpenTelemetryNodeTelemetryProvider;
  } catch (cause) {
    throw new TypeError(
      `Invalid ${OPEN_TELEMETRY_EXTENSION_PACKAGE} module: could not read export "OpenTelemetryNodeTelemetryProvider"`,
      { cause },
    );
  }

  if (!isConstructor<NodeTelemetryProvider>(candidate)) {
    throw new TypeError(
      `Invalid ${OPEN_TELEMETRY_EXTENSION_PACKAGE} module: export "OpenTelemetryNodeTelemetryProvider" must be constructible`,
    );
  }
  return candidate;
}

function createOptionalOpenTelemetryProvider(
  extensionModule: unknown,
): NodeTelemetryProvider | null {
  const Provider = resolveOptionalOpenTelemetryProviderConstructor(extensionModule);
  if (Provider === null) return null;

  const provider = new Provider();
  let initialize: unknown;
  try {
    initialize = (provider as unknown as Record<string, unknown>).initialize;
  } catch (cause) {
    throw new TypeError(
      `Invalid ${OPEN_TELEMETRY_EXTENSION_PACKAGE} module: "OpenTelemetryNodeTelemetryProvider" instance could not expose method "initialize"`,
      { cause },
    );
  }
  if (typeof initialize !== "function") {
    throw new TypeError(
      `Invalid ${OPEN_TELEMETRY_EXTENSION_PACKAGE} module: "OpenTelemetryNodeTelemetryProvider" instance must implement method "initialize"`,
    );
  }
  return provider;
}

function registerOpenTelemetryProviderIfMissing(extensionModule: unknown): void {
  if (tryResolve<NodeTelemetryProvider>(NodeTelemetryProviderName)) return;
  const provider = createOptionalOpenTelemetryProvider(extensionModule);
  if (provider === null) return;
  // A constructor can synchronously register an explicit implementation.
  // Preserve it instead of overwriting it with the default.
  if (tryResolve<NodeTelemetryProvider>(NodeTelemetryProviderName)) return;
  register<NodeTelemetryProvider>(NodeTelemetryProviderName, provider);
}

/** @internal Test-only seams; this module is not a public package entry point. */
export const cloudAgentProviderBootstrapInternals = Object.freeze({
  createOptionalOpenTelemetryProvider,
  isMissingOpenTelemetryExtension,
  registerOpenTelemetryProviderIfMissing,
  resolveOptionalOpenTelemetryProviderConstructor,
});

/**
 * Resolved options produced by `resolveNodeVeryfrontCloudAgentServiceOptions`.
 * `createBashTool` and `serviceName` are guaranteed to be set.
 */
export type ResolvedNodeVeryfrontCloudAgentServiceOptions = {
  serviceName: string;
  agentId?: string;
  baseDir?: AgentServicePathOption;
  projectDir?: string;
  entrypointUrl?: AgentServicePathOption;
  runtimeSource?: HostedRuntimeSourceIdentity;
  agentSource?: ProjectAgentRuntimeAgentSource;
  mcpServers?: readonly AgentServiceMcpServerConfig[];
  forwardedConfigNamespace?: string;
  createBashTool: AgentServiceSandboxToolsOptions["createBashTool"];
  env?: CreateNodeAgentServiceRuntimeInfrastructureOptions["env"];
  processTarget?:
    & NonNullable<CreateNodeAgentServiceRuntimeInfrastructureOptions["processTarget"]>
    & NonNullable<RunAgentServiceMainOptions["processTarget"]>
    & {
      env?: CreateNodeAgentServiceRuntimeInfrastructureOptions["env"];
      exit?: (code: number) => never | void;
    };
  drainTimeoutMs?: number;
  hardShutdownTimeoutMs?: number;
  signals?: readonly NodeJS.Signals[];
};

/** Minimum shape required by the bootstrap resolver. serviceName is optional here — it is resolved and guaranteed in the output. */
type BootstrapInput =
  & Omit<ResolvedNodeVeryfrontCloudAgentServiceOptions, "createBashTool" | "serviceName">
  & {
    createBashTool?: AgentServiceSandboxToolsOptions["createBashTool"];
    serviceName?: string;
  };

async function loadDefaultCreateBashTool(): Promise<
  AgentServiceSandboxToolsOptions["createBashTool"]
> {
  const provider = tryResolve<SandboxShellToolsProvider>(SandboxShellToolsProviderName);
  if (provider) return provider;

  try {
    const { createBashSandboxShellToolsProvider } = await importFirstPartyExtensionModule<
      SandboxShellToolsExtensionModule
    >(
      "ext-sandbox-shell-tools",
      "@veryfront/ext-sandbox-shell-tools",
    );
    return createBashSandboxShellToolsProvider;
  } catch (error) {
    throw MISSING_EXTENSION_ERROR.create({
      message:
        'Missing extension for contract "SandboxShellToolsProvider". Install @veryfront/ext-sandbox-shell-tools or pass createBashTool explicitly.',
      detail:
        `Veryfront cloud agent sandbox shell tools require a SandboxShellToolsProvider implementation: ${
          error instanceof Error ? error.message : String(error)
        }`,
    });
  }
}

/** Ensures a SchemaValidator is registered, falling back to the built-in Zod adapter. */
export async function ensureDefaultSchemaValidator(): Promise<void> {
  if (tryResolve<SchemaValidator>("SchemaValidator")) return;
  const { createZodAdapter } = await import("../../../extensions/ext-schema-zod/src/adapter.ts");
  if (tryResolve<SchemaValidator>("SchemaValidator")) return;
  const validator = createZodAdapter();
  if (!tryResolve<SchemaValidator>("SchemaValidator")) {
    register<SchemaValidator>("SchemaValidator", validator);
  }
}

async function ensureDefaultAuthProvider(): Promise<void> {
  if (tryResolve<AuthProvider>("AuthProvider")) return;
  const { createAuthProvider } = await importFirstPartyExtensionModule<AuthJwtExtensionModule>(
    "ext-auth-jwt",
    "@veryfront/ext-auth-jwt",
  );
  if (tryResolve<AuthProvider>("AuthProvider")) return;
  const provider = createAuthProvider({});
  if (!tryResolve<AuthProvider>("AuthProvider")) {
    register<AuthProvider>("AuthProvider", provider);
  }
}

async function ensureDefaultNodeTelemetryProvider(): Promise<void> {
  if (tryResolve<NodeTelemetryProvider>(NodeTelemetryProviderName)) return;
  const extensionModule = await importOpenTelemetryExtensionModule();
  registerOpenTelemetryProviderIfMissing(extensionModule);
}

async function importOpenTelemetryExtensionModule(): Promise<unknown | null> {
  try {
    return await importFirstPartyExtensionModule<unknown>(
      "ext-observability-opentelemetry",
      OPEN_TELEMETRY_EXTENSION_PACKAGE,
    );
  } catch (error) {
    if (!isMissingOpenTelemetryExtension(error)) {
      throw error;
    }
    return null;
  }
}

/** Validates and snapshots an explicit runtime source identity, rejecting branch sources. */
export function resolveHostedRuntimeSourceIdentity(
  input: HostedRuntimeSourceIdentity | undefined,
): HostedRuntimeSourceIdentity | undefined {
  if (input === undefined) return undefined;

  const source = getRuntimeAgentSourceContextSchema().parse(input);
  if (source.type === "branch") {
    throw new Error(
      "Agent service runtimeSource must identify an immutable release or environment source.",
    );
  }

  return snapshotHostedRuntimeSourceIdentity(source);
}

/**
 * Resolves all agent service options, registering default extensions (schema, auth,
 * telemetry, bash) if not already present. Returns options with `createBashTool`
 * and `serviceName` guaranteed.
 */
export async function resolveNodeVeryfrontCloudAgentServiceOptions(
  options: BootstrapInput,
): Promise<ResolvedNodeVeryfrontCloudAgentServiceOptions> {
  await ensureDefaultSchemaValidator();
  await ensureDefaultAuthProvider();
  await ensureDefaultNodeTelemetryProvider();
  return {
    ...options,
    runtimeSource: resolveHostedRuntimeSourceIdentity(options.runtimeSource),
    serviceName: resolveServiceName({
      ...options,
      env: resolveEnvironment(options),
    }),
    createBashTool: options.createBashTool ?? await loadDefaultCreateBashTool(),
  };
}
