import type { ExecutorBinding } from "#veryfront/agent/executor/protocol.ts";
import type { ExecutorChannel, ExecutorOperation } from "#veryfront/agent/executor/channel.ts";
import type { ExecutorHttpInstall } from "#veryfront/agent/hosted/executor-runtime-install-schema.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { isReservedSharedRuntimeTelemetryEnvKey } from "#veryfront/observability";
import { createProjectEnvSnapshot } from "../project-env/snapshot.ts";

export { getExecutorProjectConfigurationSchema as getExecutorHttpApplicationConfigurationSchema } from "../project-env/captured-configuration.ts";
import { getExecutorProjectConfigurationSchema as getExecutorHttpApplicationConfigurationSchema } from "../project-env/captured-configuration.ts";
import {
  createExecutorConfigurationOperation,
  readExecutorConfiguration,
} from "#veryfront/agent/hosted/executor-configuration-transport.ts";
export type ExecutorHttpApplicationConfiguration = InferSchema<
  ReturnType<typeof getExecutorHttpApplicationConfigurationSchema>
>;
const freeze = Object.freeze;

/** Refuse mismatched identity, accessors, unbounded data and private telemetry before allocation/loading. */
export function snapshotExecutorHttpApplicationConfiguration(
  input: unknown,
  installation: ExecutorHttpInstall,
): ExecutorHttpApplicationConfiguration {
  const snapshot = snapshotBoundedJsonValue(input);
  if (!snapshot.success) throw new TypeError("Invalid application configuration");
  const parsed = getExecutorHttpApplicationConfigurationSchema().safeParse(snapshot.value);
  if (!parsed.success) throw new TypeError("Invalid application configuration");
  const configuration = parsed.data;
  if (
    installation.owner.scopeKind !== "project" ||
    configuration.projectId !== installation.owner.projectId ||
    configuration.releaseId !== installation.source.releaseId ||
    configuration.environmentId !== installation.environmentId ||
    configuration.configurationId !== installation.configurationId ||
    (installation.source.type === "environment" &&
      configuration.environmentName !== installation.source.environmentName)
  ) throw new TypeError("Application configuration does not match its installation");
  const variables = createProjectEnvSnapshot(configuration.variables);
  if (Object.keys(variables).some(isReservedSharedRuntimeTelemetryEnvKey)) {
    throw new TypeError("Application environment contains host-managed telemetry settings");
  }
  return freeze({ ...configuration, variables });
}

/** Reverse operation scoped to the allocation that owns this immutable snapshot. */
export function createExecutorHttpConfigurationOperation(
  binding: ExecutorBinding,
  configuration: ExecutorHttpApplicationConfiguration,
): ExecutorOperation {
  return createExecutorConfigurationOperation(
    binding,
    configuration.configurationId,
    configuration,
  );
}

/** Receive through the authenticated channel before application code can load. */
export async function readExecutorHttpApplicationConfiguration(
  channel: Pick<ExecutorChannel, "stream">,
  installation: ExecutorHttpInstall,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<ExecutorHttpApplicationConfiguration> {
  const decoded = await readExecutorConfiguration(
    channel,
    "http.configuration",
    installation.configurationId,
    signal,
    timeoutMs,
  );
  return snapshotExecutorHttpApplicationConfiguration(decoded, installation);
}
