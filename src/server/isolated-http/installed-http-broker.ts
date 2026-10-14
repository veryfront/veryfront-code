import { EXECUTOR_MAX_TIMEOUT_MS } from "#veryfront/agent/executor/protocol.ts";
import type { HostedExecutorSessionOptions } from "#veryfront/agent/hosted/executor-session.ts";
import { getHostedExecutorImageSchema } from "#veryfront/agent/hosted/executor-session-schema.ts";
import {
  getExecutorHttpInstallSchema,
  parseExecutorInstallation,
} from "#veryfront/agent/hosted/executor-runtime-install-schema.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { snapshotInstalledProjectHttpBinding } from "../runtime-handler/installed-project.ts";
import {
  type ExecutorHttpApplicationConfiguration,
  snapshotExecutorHttpApplicationConfiguration,
} from "./application-configuration.ts";
import { createHostedHttpBroker } from "./hosted-http-broker.ts";
import type {
  HostedHttpIngressOptions,
  HostedHttpRequestAuthority,
} from "./hosted-http-ingress.ts";

export interface InstalledHttpBrokerOptions {
  /** Trusted deployment registry, independently bound to source-built image digests. */
  installations: readonly {
    image: string;
    configuration: ExecutorHttpApplicationConfiguration;
  }[];
  expectedBrokerInstanceId: string;
  allocator: HostedExecutorSessionOptions["allocator"];
  connectTransport: HostedExecutorSessionOptions["connectTransport"];
  /** Check current project/environment/release authority against the source API on every request. */
  authorize: {
    (authority: HostedHttpRequestAuthority, signal: AbortSignal): Promise<void>;
    /** Underlying host IO may outlive a refused request and remains owned through shutdown. */
    readonly pending?: number;
    readonly settled?: Promise<void>;
  };
  maxActive: number;
  /**
   * Executor lifetime after authorization, including preparation and streamed response; 1ms
   * through 24h, default 75s. Authorization time and this lifetime together never exceed
   * 24h. Align with the host request timeout and allocator policy.
   */
  requestLifetimeMs?: number;
}

function identityKey(value: HostedHttpRequestAuthority | ExecutorHttpApplicationConfiguration) {
  const binding = snapshotInstalledProjectHttpBinding({
    projectId: value.projectId,
    projectSlug: value.projectSlug,
    releaseId: value.releaseId,
    environmentId: value.environmentId,
    environmentName: value.environmentName,
  });
  return { binding, key: JSON.stringify(Object.values(binding)) };
}

/** Compose the existing broker with a fixed source-built installation registry; no host executor. */
export function createInstalledHttpBroker(options: InstalledHttpBrokerOptions) {
  if (typeof options.authorize !== "function") {
    throw new TypeError("Installed HTTP broker requires source authorization");
  }
  const requestLifetimeMs = options.requestLifetimeMs ?? 75_000;
  if (
    !Number.isSafeInteger(requestLifetimeMs) || requestLifetimeMs < 1 ||
    requestLifetimeMs > 86_400_000
  ) {
    throw new TypeError("Invalid installed HTTP request lifetime");
  }
  const expectedBrokerInstanceId = options.expectedBrokerInstanceId;
  if (
    typeof expectedBrokerInstanceId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(expectedBrokerInstanceId)
  ) {
    throw new TypeError("Invalid installed HTTP broker identity");
  }
  const snapshot = snapshotBoundedJsonValue(options.installations);
  if (
    !snapshot.success || !Array.isArray(snapshot.value) ||
    snapshot.value.length < 1 || snapshot.value.length > 64
  ) throw new TypeError("Invalid installed HTTP registry");
  const registry = new Map<string, {
    image: string;
    configuration: ExecutorHttpApplicationConfiguration;
  }>();
  for (const entry of snapshot.value) {
    if (
      !entry || typeof entry !== "object" || Array.isArray(entry) ||
      Object.keys(entry).length !== 2 || !("image" in entry) || !("configuration" in entry)
    ) throw new TypeError("Invalid installed HTTP registry entry");
    const parsedImage = getHostedExecutorImageSchema().safeParse(entry.image);
    if (!parsedImage.success) throw new TypeError("Installed HTTP image must be digest pinned");
    const raw = entry.configuration as ExecutorHttpApplicationConfiguration;
    const { binding, key } = identityKey(raw);
    const installation = parseExecutorInstallation(getExecutorHttpInstallSchema(), {
      version: 1,
      mode: "http",
      owner: { scopeKind: "project", projectId: binding.projectId },
      source: { type: "release", releaseId: binding.releaseId },
      root: "project",
      environmentId: binding.environmentId,
      configurationId: raw.configurationId,
      binding: {
        allocationId: "00000000-0000-0000-0000-000000000000",
        invocationId: "00000000-0000-0000-0000-000000000000",
        generation: 1,
      },
    });
    const configuration = snapshotExecutorHttpApplicationConfiguration(raw, installation);
    if (registry.has(key)) throw new TypeError("Duplicate installed HTTP identity");
    registry.set(key, { image: parsedImage.data, configuration });
  }
  const authorizationOwner = options.authorize;
  const authorize = options.authorize.bind(options);
  const allocator = options.allocator;
  const connectTransport = options.connectTransport;
  const owner = new AbortController();
  const broker = createHostedHttpBroker({ maxActive: options.maxActive, signal: owner.signal });
  let pendingAuthorizations = 0;
  const authorizationDrain = Promise.withResolvers<void>();
  const finishAuthorization = () => {
    pendingAuthorizations--;
    if (owner.signal.aborted && pendingAuthorizations === 0) authorizationDrain.resolve();
  };
  const hostedHttp: HostedHttpIngressOptions = {
    broker,
    resolve(authority, signal) {
      if (owner.signal.aborted) return Promise.reject(new Error("Installed HTTP broker stopped"));
      // Reserve before invoking host callbacks, including reentrant shutdown.
      pendingAuthorizations++;
      const operation = resolveInput(authority, signal);
      void operation.then(finishAuthorization, finishAuthorization);
      return operation;
    },
  };
  async function resolveInput(
    authority: HostedHttpRequestAuthority,
    signal: AbortSignal,
  ): Promise<Awaited<ReturnType<HostedHttpIngressOptions["resolve"]>>> {
    signal.throwIfAborted();
    owner.signal.throwIfAborted();
    const { binding, key } = identityKey(authority);
    const selected = registry.get(key);
    if (!selected) throw new Error("Installed HTTP source is unavailable");
    const sourceToken = authority.sourceToken;
    if (typeof sourceToken !== "string" || !/^[\x21-\x7e]{1,8192}$/.test(sourceToken)) {
      throw new TypeError("Invalid installed HTTP source authority");
    }
    const lifetime = AbortSignal.any([signal, owner.signal]);
    // Authorization starts now. The broker orders generation changes by this time, so an
    // authorization that finishes late cannot pass for a newer one.
    const requestedAt = Date.now();
    await authorize(Object.freeze({ ...binding, sourceToken }), lifetime);
    lifetime.throwIfAborted();
    // The configured lifetime runs from the end of authorization. The allocation as a
    // whole, authorization included, stays within the executor session bound.
    const now = Date.now();
    const hardDeadlineAt = Math.min(now + requestLifetimeMs, requestedAt + EXECUTOR_MAX_TIMEOUT_MS);
    const configuration = selected.configuration;
    const source = { type: "release" as const, releaseId: binding.releaseId };
    const projectOwner = { scopeKind: "project" as const, projectId: binding.projectId };
    return {
      session: {
        request: {
          allocationId: crypto.randomUUID(),
          invocationId: crypto.randomUUID(),
          owner: projectOwner,
          source,
          executionProfile: "http",
          requestedAt,
          prepareDeadlineAt: Math.min(now + Math.min(30_000, requestLifetimeMs), hardDeadlineAt),
          hardDeadlineAt,
        },
        expectedBrokerInstanceId,
        expectedImage: selected.image,
        allocator,
        connectTransport,
        ownerSignal: owner.signal,
      },
      installation: {
        version: 1,
        mode: "http",
        owner: projectOwner,
        source,
        root: "project",
        environmentId: binding.environmentId,
        configurationId: configuration.configurationId,
      },
      configuration,
    };
  }
  return {
    hostedHttp,
    get active() {
      return broker.active;
    },
    get settled() {
      return Promise.all([broker.settled, authorizationDrain.promise])
        .then(() => authorizationOwner.settled)
        .then(() => {});
    },
    async shutdown() {
      owner.abort();
      if (pendingAuthorizations === 0) authorizationDrain.resolve();
      const notice = await broker.shutdown();
      return {
        ...notice,
        pending: notice.pending + Math.max(pendingAuthorizations, authorizationOwner.pending ?? 0),
      };
    },
  };
}
