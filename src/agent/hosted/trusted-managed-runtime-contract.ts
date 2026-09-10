import type { ExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import type { ExecutorOperationGate } from "#veryfront/agent/executor/operation-gate.ts";
import type { ExecutorBinding } from "#veryfront/agent/executor/protocol.ts";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import type { HostedExecutorOwnedWork } from "./executor-session.ts";
import type { ExecutorRuntimeInstall } from "./executor-runtime-install-schema.ts";
import type { ExecutorProjectToolSource } from "./executor-project-tools.ts";
import type { ExecutorToolLimits } from "./executor-tool-schema.ts";

/** Internal trusted-process composition, supplied only at broker construction. */
export interface TrustedManagedRuntimeOptions {
  binding: ExecutorBinding;
  defaultTimeoutMs: number;
  installation: ExecutorRuntimeInstall;
  projectChannel: ExecutorChannel;
  projectToolNames: readonly string[];
  toolLimits: ExecutorToolLimits;
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
  createGate(projectTools: ExecutorProjectToolSource): ExecutorOperationGate;
  signal: AbortSignal;
  runOwned: HostedExecutorOwnedWork;
  requestSessionClose(): void;
}

/** Local work must retire independently of the owning session's settlement. */
export interface TrustedManagedRuntime {
  readonly channel: ExecutorChannel;
  readonly gate: ExecutorOperationGate;
  readonly settled: Promise<void>;
  close(): Promise<void>;
}

export type TrustedManagedRuntimeFactory = (
  options: TrustedManagedRuntimeOptions,
) => Promise<TrustedManagedRuntime>;
