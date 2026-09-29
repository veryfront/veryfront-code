import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import process from "node:process";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { ExecutorChannel } from "../executor/channel.ts";
import { createExecutorHttpOperation } from "#veryfront/server/isolated-http/executor-http.ts";
import type { ExecutorHttpInstall } from "./executor-runtime-install-schema.ts";
import {
  type ExecutorNodeBootstrapOptions,
  readExecutorBootstrapConfiguration,
  startExecutorNodeBootstrap,
} from "./executor-node-bootstrap.ts";
import { createExecutorRuntimeInstallation } from "./executor-runtime-install.ts";
import { awaitExecutorCleanup } from "./executor-runtime-settlement.ts";
export { initializeExecutorRuntimeContracts } from "./executor-runtime-contracts.ts";
import {
  type ExecutorArtifactManifest,
  getExecutorArtifactManifestSchema,
  parseExecutorInstallation,
} from "./executor-runtime-install-schema.ts";

const ARTIFACT_MANIFEST = "/opt/veryfront/executor-artifact.json";
const PROJECT_ROOT = "/opt/veryfront/project";

/** Trusted image-owned HTTP runtime, constructed after exact artifact/owner installation. */
export interface ExecutorHttpRuntime {
  handle(request: Request): Response | Promise<Response>;
  close(): Promise<void>;
  readonly settled: Promise<void>;
}

async function readFixedArtifact() {
  const file = await open(
    ARTIFACT_MANIFEST,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022) !== 0 || stat.size > 64 * 1024) {
      throw new Error("Invalid executor artifact");
    }
    const buffer = new Uint8Array(64 * 1024 + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > 64 * 1024) throw new Error("Invalid executor artifact");
    const manifest = parseExecutorInstallation(
      getExecutorArtifactManifestSchema(),
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset))),
    );
    return { manifest, projectDir: PROJECT_ROOT };
  } catch {
    throw new Error("Invalid executor artifact");
  } finally {
    await file.close();
  }
}

/**
 * Dedicated executor entrypoint. The reviewed image launcher registers its
 * first-party SchemaValidator, Bundler, ModuleLexer and SkillDocumentParserProvider before calling
 * this function. The fixed image
 * manifest is outside the project tree and is never selected by channel input.
 * The default runtime profile installs agent grants and capabilities. The project-tools
 * profile installs only fixed-context project tool operations; it cannot prepare or stream agents.
 * The HTTP profile uses an image-owned handler factory and exposes only HTTP
 * dispatch after owner/source installation; it never installs agent capabilities.
 */
export async function startExecutorRuntimeEntrypoint(
  options: Pick<ExecutorNodeBootstrapOptions, "environment" | "readKey" | "signal"> & {
    /** Trusted image profile, fixed before project discovery. */
    mode?: "runtime" | "project-tools" | "http";
    /**
     * Required for the HTTP image profile. Bind the authenticated environment
     * configuration and fixed project root before loading tenant modules. Never
     * select a loader, executable or filesystem path from channel input.
     */
    createHttpRuntime?(input: {
      installation: ExecutorHttpInstall;
      projectDir: string;
      signal: AbortSignal;
    }): Promise<ExecutorHttpRuntime>;
    /** Trusted image/test boundary, never a channel field or environment path. */
    readArtifact?: () => Promise<{ manifest: ExecutorArtifactManifest; projectDir: string }>;
  } = {},
) {
  const mode = options.mode;
  if (mode !== undefined && mode !== "runtime" && mode !== "project-tools" && mode !== "http") {
    throw new TypeError("Invalid executor installation profile");
  }
  const createHttpRuntime = options.createHttpRuntime;
  if (
    (mode === "http" && typeof createHttpRuntime !== "function") ||
    (mode !== "http" && createHttpRuntime !== undefined)
  ) {
    throw new TypeError("HTTP runtime factory requires the HTTP profile");
  }
  const environment = options.environment ?? { get: (name) => process.env[name] };
  const { binding } = readExecutorBootstrapConfiguration(environment);
  for (
    const contract of ["SchemaValidator", "Bundler", "ModuleLexer", "SkillDocumentParserProvider"]
  ) {
    if (!tryResolve(contract)) throw new TypeError("Executor runtime contracts are unavailable");
  }
  const artifact = await (options.readArtifact ?? readFixedArtifact)();
  if (!isAbsolute(artifact.projectDir)) throw new TypeError("Invalid executor project root");
  const lifetime = new AbortController();
  const signal = AbortSignal.any([lifetime.signal, ...(options.signal ? [options.signal] : [])]);
  signal.throwIfAborted();
  const channel = Promise.withResolvers<ExecutorChannel>();
  void channel.promise.catch(() => {});
  const installation = mode === "http"
    ? createExecutorRuntimeInstallation({
      mode: "http",
      binding,
      artifact: artifact.manifest,
      signal,
      async install(input, runtimeSignal) {
        if (input.owner.scopeKind !== "project") {
          throw new TypeError("HTTP requires project ownership");
        }
        const traceIdentity = {
          projectId: input.owner.projectId,
          environmentId: input.environmentId,
        };
        const connected = await channel.promise;
        runtimeSignal.throwIfAborted();
        const runtime = await createHttpRuntime!({
          installation: input,
          projectDir: artifact.projectDir,
          signal: runtimeSignal,
        });
        return {
          operations: new Map([[
            "http.request",
            createExecutorHttpOperation({
              binding,
              channel: () => connected,
              handle: runtime.handle.bind(runtime),
              traceIdentity,
            }),
          ]]),
          close: runtime.close.bind(runtime),
          settled: runtime.settled,
        };
      },
    })
    : mode === "project-tools"
    ? createExecutorRuntimeInstallation({
      mode: "project-tools",
      binding,
      artifact: artifact.manifest,
      signal,
      async install(input, runtimeSignal, context) {
        // Project-only installation never constructs model or host capability proxies.
        const { createExecutorDiscovery } = await import("./executor-discovery.ts");
        const { createExecutorProjectToolRuntime } = await import("./executor-project-runtime.ts");
        runtimeSignal.throwIfAborted();
        const discovery = createExecutorDiscovery({
          binding,
          source: input.source,
          projectDir: artifact.projectDir,
          defaultAgentId: input.context.agentId,
          signal: runtimeSignal,
        });
        return await createExecutorProjectToolRuntime({
          input,
          discovery,
          signal: runtimeSignal,
          deadline: context.deadline,
        });
      },
    })
    : createExecutorRuntimeInstallation({
      binding,
      artifact: artifact.manifest,
      signal,
      async install(input, runtimeSignal) {
        // No project discovery, runtime factories or capability construction is
        // evaluated until the authenticated one-shot installation has passed.
        const { createExecutorRuntimeFacades } = await import("./executor-runtime-facades.ts");
        const facades = await createExecutorRuntimeFacades({
          input,
          channel: await channel.promise,
          signal: runtimeSignal,
        });
        let discovery: import("./executor-discovery.ts").ExecutorDiscovery | undefined;
        try {
          runtimeSignal.throwIfAborted();
          const { createExecutorDiscovery } = await import("./executor-discovery.ts");
          discovery = createExecutorDiscovery({
            binding,
            source: input.source,
            projectDir: artifact.projectDir,
            defaultAgentId: input.grant.agentId,
            signal: runtimeSignal,
          });
          const { createExecutorRuntimePreparation } = await import(
            "./executor-runtime-prepare.ts"
          );
          runtimeSignal.throwIfAborted();
          return createExecutorRuntimePreparation({
            binding,
            source: input.source,
            discovery,
            facades,
            grant: {
              ...input.grant,
              models: new Map(input.grant.models.map(({ id, ...policy }) => [id, policy])),
            },
          });
        } catch (error) {
          await Promise.allSettled([facades.cleanup(), discovery?.close()]);
          throw error;
        }
      },
    });
  try {
    const bootstrap = await startExecutorNodeBootstrap({
      ...options,
      environment,
      operations: installation.operations,
      signal,
    });
    void bootstrap.ready.then(channel.resolve, channel.reject);
    void bootstrap.ready.then(async (connected) => {
      await connected.closed;
      lifetime.abort();
    }).catch(() => lifetime.abort());
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      if (!closing) {
        closing = awaitExecutorCleanup([
          Promise.resolve().then(() => bootstrap.close()),
          Promise.resolve().then(() => installation.close()),
          channel.promise.then((connected) => connected.settled, () => {}),
        ]);
        lifetime.abort();
      }
      return closing;
    };
    const settled = awaitExecutorCleanup([
      installation.settled,
      channel.promise.then((connected) => connected.settled, () => {}),
    ]);
    void settled.catch(() => {});
    return { address: bootstrap.address, ready: bootstrap.ready, close, settled };
  } catch (error) {
    channel.reject(new Error("Executor startup failed"));
    await installation.close();
    throw error;
  }
}
