import type { ExecutorBinding } from "#veryfront/agent/executor/protocol.ts";
import type { ExecutorChannel, ExecutorOperation } from "#veryfront/agent/executor/channel.ts";
import type { ExecutorHttpInstall } from "#veryfront/agent/hosted/executor-runtime-install-schema.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { isReservedSharedRuntimeTelemetryEnvKey } from "#veryfront/observability";
import { createProjectEnvSnapshot } from "../project-env/snapshot.ts";
import { getInstalledProjectHttpBindingSchema } from "../runtime-handler/installed-project.ts";

const CHUNK_CHARS = 32 * 1024;
const MAX_CONFIGURATION_CHARS = 4 * 1024 * 1024;
const MAX_CONFIGURATION_CHUNKS = MAX_CONFIGURATION_CHARS / CHUNK_CHARS;
const now = Date.now;
const parse = JSON.parse;
const freeze = Object.freeze;

/** Project-authorized snapshot. Collector settings remain on the broker. */
export const getExecutorHttpApplicationConfigurationSchema = defineSchema((v) =>
  getInstalledProjectHttpBindingSchema().extend({
    configurationId: v.string().min(1).max(256),
    variables: v.record(v.string(), v.string()),
  }).strict()
);
export type ExecutorHttpApplicationConfiguration = InferSchema<
  ReturnType<typeof getExecutorHttpApplicationConfigurationSchema>
>;

const getConfigurationRequestSchema = defineSchema((v) =>
  v.object({ configurationId: v.string().min(1).max(256) }).strict()
);
const getConfigurationChunkSchema = defineSchema((v) =>
  v.object({
    index: v.number().int().nonnegative().max(MAX_CONFIGURATION_CHUNKS - 1),
    text: v.string().min(1).max(CHUNK_CHARS),
  })
    .strict()
);

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
  const expected = { ...binding };
  const configurationId = configuration.configurationId;
  const text = privateJsonStringify(configuration);
  if (typeof text !== "string" || text.length > MAX_CONFIGURATION_CHARS) {
    throw new TypeError("Application configuration is too large");
  }
  return {
    mode: "stream",
    async *handle(value, context) {
      const request = getConfigurationRequestSchema().safeParse(value);
      if (
        !request.success || request.data.configurationId !== configurationId ||
        context.binding.allocationId !== expected.allocationId ||
        context.binding.invocationId !== expected.invocationId ||
        context.binding.generation !== expected.generation
      ) throw new TypeError("Application configuration is unavailable");
      let index = 0;
      for (let offset = 0; offset < text.length; offset += CHUNK_CHARS) {
        context.signal.throwIfAborted();
        if (context.deadline <= now()) throw new Error("Application configuration request expired");
        yield { index: index++, text: text.slice(offset, offset + CHUNK_CHARS) };
      }
    },
  };
}

/** Receive through the authenticated channel before application code can load. */
export async function readExecutorHttpApplicationConfiguration(
  channel: Pick<ExecutorChannel, "stream">,
  installation: ExecutorHttpInstall,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<ExecutorHttpApplicationConfiguration> {
  signal.throwIfAborted();
  let text = "";
  let index = 0;
  for await (
    const value of channel.stream("http.configuration", {
      configurationId: installation.configurationId,
    }, { signal, timeoutMs })
  ) {
    const chunk = getConfigurationChunkSchema().safeParse(value);
    if (!chunk.success || chunk.data.index !== index++) {
      throw new TypeError("Invalid application configuration stream");
    }
    if (text.length + chunk.data.text.length > MAX_CONFIGURATION_CHARS) {
      throw new TypeError("Application configuration is too large");
    }
    text += chunk.data.text;
  }
  signal.throwIfAborted();
  let decoded: unknown;
  try {
    decoded = parse(text);
  } catch {
    throw new TypeError("Invalid application configuration stream");
  }
  return snapshotExecutorHttpApplicationConfiguration(decoded, installation);
}
