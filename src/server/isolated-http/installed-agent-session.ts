import { EXECUTOR_MAX_TIMEOUT_MS } from "#veryfront/agent/executor/protocol.ts";
import { executorNodeClock } from "#veryfront/agent/hosted/executor-node-deadline.ts";
import type { HostedExecutorSessionOptions } from "#veryfront/agent/hosted/executor-session.ts";
import {
  getHostedExecutorAllocationRequestSchema,
  getHostedExecutorIdentifierSchema,
  getHostedExecutorImageSchema,
  parseHostedExecutorData,
} from "#veryfront/agent/hosted/executor-session-schema.ts";
import {
  BrokerIngressError,
  type BrokerRuntimeAgentExecutorInput,
} from "#veryfront/agent/service/broker-ingress.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { getExecutorHttpApplicationConfigurationSchema } from "./application-configuration.ts";
import type { InstalledHttpBrokerOptions } from "./installed-http-broker.ts";

type Session = Omit<HostedExecutorSessionOptions, "createOperations">;

/** Trusted native deployment registry and transport for captured project releases. */
export type InstalledProjectAgentSessionOptions =
  & Pick<
    InstalledHttpBrokerOptions,
    | "installations"
    | "expectedBrokerInstanceId"
    | "allocator"
    | "connectTransport"
    | "observeAttachment"
  >
  & Pick<Session, "ownerSignal" | "clock" | "requestTimeoutMs" | "cleanupTimeoutMs">
  & {
    /** Whole allocation budget, including preparation; default five minutes. */
    lifetimeMs?: number;
    /** Default thirty seconds, clamped to the whole allocation and signed run deadline. */
    preparationMs?: number;
  };

/**
 * Resolve registered source metadata after signature verification, then select
 * a digest-pinned session after live dispatch admission. This selects session
 * data, not execution authority.
 * HTTP-app variables stay in the broker and are never part of the result.
 *
 * @param options Host-owned registry, scoped allocator and authenticated transport.
 * @returns A session resolver with a signature-gated `resolveBoundSource` metadata lookup.
 * See the self-hosting guide for canonical authorization, budgets and shutdown.
 */
export function createInstalledProjectAgentSessionResolver(
  options: InstalledProjectAgentSessionOptions,
) {
  const brokerId = getHostedExecutorIdentifierSchema().parse(options.expectedBrokerInstanceId);
  const lifetimeMs = options.lifetimeMs ?? 300_000;
  const preparationMs = options.preparationMs ?? 30_000;
  for (const limit of [lifetimeMs, preparationMs]) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > EXECUTOR_MAX_TIMEOUT_MS) {
      throw new TypeError("Invalid installed agent session budget");
    }
  }
  const snapshot = snapshotBoundedJsonValue(options.installations);
  if (
    !snapshot.success || !Array.isArray(snapshot.value) || snapshot.value.length < 1 ||
    snapshot.value.length > 64
  ) {
    throw new TypeError("Invalid installed project release registry");
  }
  const registry = new Map<string, string>();
  const key = (projectId: string, environmentId: string, releaseId: string) =>
    JSON.stringify([projectId, environmentId, releaseId]);
  for (const entry of snapshot.value) {
    if (
      !entry || typeof entry !== "object" || Array.isArray(entry) ||
      Object.keys(entry).length !== 2 ||
      !("image" in entry) || !("configuration" in entry)
    ) throw new TypeError("Invalid installed project release");
    const parsedImage = getHostedExecutorImageSchema().safeParse(entry.image);
    if (!parsedImage.success) throw new TypeError("Installed agent image must be digest pinned");
    const parsedConfig = getExecutorHttpApplicationConfigurationSchema().safeParse(
      entry.configuration,
    );
    if (!parsedConfig.success) throw new TypeError("Invalid installed project release identity");
    const image = parsedImage.data;
    const config = parsedConfig.data;
    const identity = key(config.projectId, config.environmentId, config.releaseId);
    if (registry.has(identity) && registry.get(identity) !== image) {
      throw new TypeError("Ambiguous installed project release");
    }
    registry.set(identity, image);
  }
  const clock = options.clock ?? executorNodeClock;
  const ownerSignal = options.ownerSignal;
  const allocator = options.allocator;
  const connectTransport = options.connectTransport.bind(options);
  const observeAttachment = options.observeAttachment?.bind(options);
  const requestTimeoutMs = options.requestTimeoutMs;
  const cleanupTimeoutMs = options.cleanupTimeoutMs;
  const select = (input: {
    sourceProject: BrokerRuntimeAgentExecutorInput["run"]["project"];
    requestedSource: BrokerRuntimeAgentExecutorInput["agentSource"];
  }) => {
    const project = input.sourceProject, source = input.requestedSource;
    if (
      source.type !== "release" || project.runtimeTargetKind !== "environment" ||
      !project.runtimeTargetEnvironmentId ||
      (project.sourceTargetEnvironmentId &&
        project.sourceTargetEnvironmentId !== project.runtimeTargetEnvironmentId)
    ) return undefined;
    const image = registry.get(
      key(project.projectId, project.runtimeTargetEnvironmentId, source.releaseId),
    );
    return image === undefined
      ? undefined
      : { image, source: { type: "release" as const, releaseId: source.releaseId } };
  };
  const resolveBoundSource = (input: Parameters<typeof select>[0]) => select(input)?.source;
  const resolve = (executor: BrokerRuntimeAgentExecutorInput, signal: AbortSignal): Session => {
    signal.throwIfAborted();
    ownerSignal?.throwIfAborted();
    const project = executor.sourceProject ?? executor.run.project;
    if (executor.owner.scopeKind !== "project" || executor.owner.projectId !== project.projectId) {
      throw new BrokerIngressError(403, "BROKER_INGRESS_SCOPE_DENIED");
    }
    const selection = select({ sourceProject: project, requestedSource: executor.agentSource });
    if (!selection) throw new BrokerIngressError(503, "BROKER_UNAVAILABLE");
    const { image, source } = selection;
    const now = Math.floor(clock.now());
    const deadline = executor.run.effectiveDeadlineAt === undefined
      ? now + lifetimeMs
      : Date.parse(executor.run.effectiveDeadlineAt);
    const hardDeadlineAt = Math.min(now + lifetimeMs, deadline);
    if (!Number.isFinite(hardDeadlineAt) || hardDeadlineAt <= clock.now()) {
      throw new BrokerIngressError(409, "BROKER_RUN_NOT_ACTIVE");
    }
    const request = parseHostedExecutorData(getHostedExecutorAllocationRequestSchema(), {
      allocationId: crypto.randomUUID(),
      invocationId: crypto.randomUUID(),
      owner: { scopeKind: "project", projectId: project.projectId },
      source: { type: "release", releaseId: source.releaseId },
      executionProfile: "project-tools",
      requestedAt: now,
      prepareDeadlineAt: Math.min(now + preparationMs, hardDeadlineAt),
      hardDeadlineAt,
    });
    return {
      request,
      expectedBrokerInstanceId: brokerId,
      expectedImage: image,
      allocator,
      connectTransport,
      clock,
      preparationSignal: signal,
      ...(ownerSignal === undefined ? {} : { ownerSignal }),
      ...(observeAttachment === undefined ? {} : { observeAttachment }),
      ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
      ...(cleanupTimeoutMs === undefined ? {} : { cleanupTimeoutMs }),
    };
  };
  return Object.freeze(Object.assign(resolve, { resolveBoundSource }));
}
