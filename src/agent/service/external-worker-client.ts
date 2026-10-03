import { finalizeConversationAgentRun } from "../conversation/durable.ts";
import { terminalRoute } from "../conversation/terminal-route.ts";
import type { Schema, SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { defineSchema } from "../../schemas/define.ts";
import { lazySchema } from "../../schemas/lazy.ts";
import { NETWORK_ERROR } from "#veryfront/errors";

/** Public API contract for external agent worker. */
export interface ExternalAgentWorker {
  id: string;
  project_id: string;
  implementation_kind: string;
  worker_key: string;
  display_name?: string | null;
  status?: string;
  metadata?: unknown | null;
  last_heartbeat_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Public API contract for external agent worker request snapshot. */
export interface ExternalAgentWorkerRequestSnapshot {
  taskId?: string;
  messages: Array<{
    id: string;
    role: string;
    parts: Array<{ type: string } & Record<string, unknown>>;
    metadata?: Record<string, unknown>;
    createdAt?: string;
  }>;
  tools: unknown[];
  context: unknown[];
  forwardedProps?: Record<string, unknown>;
  traceContext?: unknown;
}

/** Public API contract for external agent worker session. */
export interface ExternalAgentWorkerSession {
  id: string;
  run_id: string;
  implementation_kind: string;
  worker_id: string | null;
  session_key: string;
  status: string;
  metadata?: unknown | null;
  created_at?: string;
  updated_at?: string;
  ended_at?: string | null;
}

/** Public API contract for external agent worker run. */
export interface ExternalAgentWorkerRun {
  run_id: string;
  conversation_id: string;
  message_id: string;
  project_id: string | null;
  agent_id: string;
  status: string;
  request_snapshot: ExternalAgentWorkerRequestSnapshot | null;
  source_target_kind?: string | null;
  source_target_environment_id?: string | null;
  source_target_branch_id?: string | null;
  source_target_release_version?: string | null;
  runtime_target_kind?: string | null;
  runtime_target_environment_id?: string | null;
  runtime_target_branch_id?: string | null;
  latest_event_id: number;
  latest_external_event_sequence: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  worker_session: ExternalAgentWorkerSession | null;
}

function externalAgentWorker(v: SchemaValidator): Schema<ExternalAgentWorker> {
  return v.object({
    id: v.string().uuid(),
    project_id: v.string().uuid(),
    implementation_kind: v.string(),
    worker_key: v.string(),
    display_name: v.string().nullable().optional(),
    status: v.string().optional(),
    metadata: v.unknown().nullable().optional(),
    last_heartbeat_at: v.string().nullable().optional(),
    created_at: v.string().optional(),
    updated_at: v.string().optional(),
  });
}

/** Zod schema for external agent worker. */
export const ExternalAgentWorkerSchema = lazySchema(
  defineSchema<ExternalAgentWorker>(externalAgentWorker),
);

function externalAgentWorkerRequestMessage(
  v: SchemaValidator,
): Schema<ExternalAgentWorkerRequestSnapshot["messages"][number]> {
  return v.object({
    id: v.string(),
    role: v.string(),
    parts: v.array(v.object({ type: v.string() }).passthrough()).default([]),
    metadata: v.record(v.string(), v.unknown()).optional(),
    createdAt: v.string().optional(),
  });
}

function externalAgentWorkerRequestSnapshot(
  v: SchemaValidator,
): Schema<ExternalAgentWorkerRequestSnapshot> {
  return v.object({
    taskId: v.string().optional(),
    messages: v.array(externalAgentWorkerRequestMessage(v)),
    tools: v.array(v.unknown()).default([]),
    context: v.array(v.unknown()).default([]),
    forwardedProps: v.record(v.string(), v.unknown()).optional(),
    traceContext: v.unknown().optional(),
  });
}

/** Zod schema for external agent worker request snapshot. */
export const ExternalAgentWorkerRequestSnapshotSchema = lazySchema(
  defineSchema<ExternalAgentWorkerRequestSnapshot>(externalAgentWorkerRequestSnapshot),
);

function externalAgentWorkerSession(v: SchemaValidator): Schema<ExternalAgentWorkerSession> {
  return v.object({
    id: v.string().uuid(),
    run_id: v.string(),
    implementation_kind: v.string(),
    worker_id: v.string().uuid().nullable(),
    session_key: v.string(),
    status: v.string(),
    metadata: v.unknown().nullable().optional(),
    created_at: v.string().optional(),
    updated_at: v.string().optional(),
    ended_at: v.string().nullable().optional(),
  });
}

/** Zod schema for external agent worker session. */
export const ExternalAgentWorkerSessionSchema = lazySchema(
  defineSchema<ExternalAgentWorkerSession>(externalAgentWorkerSession),
);

function externalAgentWorkerRun(v: SchemaValidator): Schema<ExternalAgentWorkerRun> {
  return v.object({
    run_id: v.string(),
    conversation_id: v.string().uuid(),
    message_id: v.string().uuid(),
    project_id: v.string().uuid().nullable(),
    agent_id: v.string(),
    status: v.string(),
    request_snapshot: externalAgentWorkerRequestSnapshot(v).nullable(),
    source_target_kind: v.string().nullable().optional(),
    source_target_environment_id: v.string().uuid().nullable().optional(),
    source_target_branch_id: v.string().uuid().nullable().optional(),
    source_target_release_version: v.string().nullable().optional(),
    runtime_target_kind: v.string().nullable().optional(),
    runtime_target_environment_id: v.string().uuid().nullable().optional(),
    runtime_target_branch_id: v.string().uuid().nullable().optional(),
    latest_event_id: v.number(),
    latest_external_event_sequence: v.number(),
    lease_owner: v.string().nullable(),
    lease_expires_at: v.string().nullable(),
    worker_session: externalAgentWorkerSession(v).nullable().default(null),
  });
}

/** Zod schema for external agent worker run. */
export const ExternalAgentWorkerRunSchema = lazySchema(
  defineSchema<ExternalAgentWorkerRun>(externalAgentWorkerRun),
);

const RegisterExternalAgentWorkerResponseSchema = lazySchema(
  defineSchema<{ worker: ExternalAgentWorker; token: string }>((v) =>
    v.object({
      worker: externalAgentWorker(v),
      token: v.string().min(1),
    })
  ),
);

type RunCredentials = { auth_token: string; run_event_token: string; run_terminal_token: string };
const NativeMap = Map;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const mapDelete = Map.prototype.delete;
const apply = Reflect.apply;
const WorkerClaimSchema = lazySchema(
  defineSchema<{ run: ExternalAgentWorkerRun | null; credentials?: RunCredentials }>((v) =>
    v.object({
      run: externalAgentWorkerRun(v).nullable(),
      credentials: v.object({
        auth_token: v.string().min(1),
        run_event_token: v.string().min(1),
        run_terminal_token: v.string().min(1),
      }).optional(),
    })
  ),
);

/** Options accepted by external agent worker client. */
export interface ExternalAgentWorkerClientOptions {
  apiUrl: string;
  authToken: string;
  fetch?: typeof fetch;
}

/** Input payload for register external agent worker. */
export interface RegisterExternalAgentWorkerInput {
  projectReference: string;
  implementationKind: string;
  implementationDisplayName: string;
  workerKey: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
}

/** Input payload for claim external agent worker run. */
export interface ClaimExternalAgentWorkerRunInput {
  workerId: string;
  leaseDurationSeconds: number;
}

/** Input payload for record external agent worker session. */
export interface RecordExternalAgentWorkerSessionInput {
  workerId: string;
  runId: string;
  sessionKey: string;
  status?: "active" | "completed" | "failed" | "cancelled";
  metadata?: Record<string, unknown>;
}

/** Input payload for complete external agent worker run. */
export interface CompleteExternalAgentWorkerRunInput {
  runId: string;
  status: "completed" | "failed" | "cancelled";
  output?: unknown;
  terminalErrorCode?: string;
  terminalErrorMessage?: string;
}

/** Input payload for append external agent worker run events. */
export interface AppendExternalAgentWorkerRunEventsInput {
  conversationId: string;
  runId: string;
  events: unknown[];
  expectedPreviousExternalEventSequence?: number;
}

/** Public API contract for external agent worker client. */
export interface ExternalAgentWorkerClient {
  registerWorker(input: RegisterExternalAgentWorkerInput): Promise<ExternalAgentWorker>;
  heartbeatWorker(workerId: string): Promise<ExternalAgentWorker>;
  claimRun(input: ClaimExternalAgentWorkerRunInput): Promise<ExternalAgentWorkerRun | null>;
  renewLease(input: ClaimExternalAgentWorkerRunInput & { runId: string }): Promise<
    ExternalAgentWorkerRun | null
  >;
  recordSession(input: RecordExternalAgentWorkerSessionInput): Promise<
    ExternalAgentWorkerSession
  >;
  appendRunEvents(input: AppendExternalAgentWorkerRunEventsInput): Promise<void>;
  completeRun(input: CompleteExternalAgentWorkerRunInput): Promise<void>;
}

class DefaultExternalAgentWorkerClient implements ExternalAgentWorkerClient {
  readonly #apiUrl: string;
  readonly #authToken: string;
  readonly #fetch: typeof fetch;
  readonly #runCredentials = new NativeMap<string, RunCredentials>();
  readonly #workerTokensByWorkerId = new Map<string, string>();

  constructor(options: ExternalAgentWorkerClientOptions) {
    this.#apiUrl = options.apiUrl.replace(/\/$/, "");
    this.#authToken = options.authToken;
    this.#fetch = options.fetch ?? fetch;
  }

  async #request<T>(
    path: string,
    schema: Schema<T>,
    init: RequestInit = {},
    options: { workerId?: string } = {},
  ): Promise<T> {
    const token = options.workerId
      ? this.#workerTokensByWorkerId.get(options.workerId) ?? this.#authToken
      : this.#authToken;
    const response = await this.#fetch(`${this.#apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw NETWORK_ERROR.create({
        detail: body || `Veryfront API returned HTTP ${response.status}`,
      });
    }

    return schema.parse(await response.json());
  }

  async registerWorker(
    input: RegisterExternalAgentWorkerInput,
  ): Promise<ExternalAgentWorker> {
    const response = await this.#request(
      `/agent-workers/projects/${encodeURIComponent(input.projectReference)}/workers`,
      RegisterExternalAgentWorkerResponseSchema,
      {
        method: "POST",
        body: JSON.stringify({
          implementation_kind: input.implementationKind,
          implementation_display_name: input.implementationDisplayName,
          worker_key: input.workerKey,
          display_name: input.displayName,
          metadata: input.metadata,
        }),
      },
    );

    this.#workerTokensByWorkerId.set(response.worker.id, response.token);
    return response.worker;
  }

  async heartbeatWorker(workerId: string): Promise<ExternalAgentWorker> {
    const response = await this.#request(
      `/agent-workers/workers/${encodeURIComponent(workerId)}/heartbeat`,
      lazySchema(
        defineSchema<{ worker: ExternalAgentWorker }>((v) =>
          v.object({ worker: externalAgentWorker(v) })
        ),
      ),
      { method: "POST" },
      { workerId },
    );
    return response.worker;
  }

  async claimRun(
    input: ClaimExternalAgentWorkerRunInput,
  ): Promise<ExternalAgentWorkerRun | null> {
    const response = await this.#request(
      `/agent-workers/workers/${encodeURIComponent(input.workerId)}/claim`,
      WorkerClaimSchema,
      {
        method: "POST",
        body: JSON.stringify({ lease_duration_seconds: input.leaseDurationSeconds }),
      },
      { workerId: input.workerId },
    );
    if (response.run && response.credentials) {
      terminalRoute(response.credentials.run_terminal_token, response.run.run_id);
      apply(mapSet, this.#runCredentials, [response.run.run_id, response.credentials]);
    }
    if (response.run && !response.credentials) {
      apply(mapDelete, this.#runCredentials, [response.run.run_id]);
    }
    return response.run;
  }

  async renewLease(
    input: ClaimExternalAgentWorkerRunInput & { runId: string },
  ): Promise<ExternalAgentWorkerRun | null> {
    const response = await this.#request(
      `/agent-workers/workers/${encodeURIComponent(input.workerId)}/runs/${
        encodeURIComponent(input.runId)
      }/lease`,
      WorkerClaimSchema,
      {
        method: "POST",
        body: JSON.stringify({ lease_duration_seconds: input.leaseDurationSeconds }),
      },
      { workerId: input.workerId },
    );
    if (response.run && response.credentials) {
      terminalRoute(response.credentials.run_terminal_token, response.run.run_id);
      apply(mapSet, this.#runCredentials, [response.run.run_id, response.credentials]);
    }
    // The lease endpoint returns only `{ run }`; renewal keeps the claim's
    // credentials. Drop them only when the lease is no longer held.
    if (!response.run) {
      apply(mapDelete, this.#runCredentials, [input.runId]);
    }
    return response.run;
  }

  async recordSession(
    input: RecordExternalAgentWorkerSessionInput,
  ): Promise<ExternalAgentWorkerSession> {
    const response = await this.#request(
      `/agent-workers/workers/${encodeURIComponent(input.workerId)}/runs/${
        encodeURIComponent(input.runId)
      }/session`,
      lazySchema(
        defineSchema<{ session: ExternalAgentWorkerSession }>((v) =>
          v.object({ session: externalAgentWorkerSession(v) })
        ),
      ),
      {
        method: "PUT",
        body: JSON.stringify({
          session_key: input.sessionKey,
          status: input.status,
          metadata: input.metadata,
        }),
      },
      { workerId: input.workerId },
    );
    return response.session;
  }

  #credentialsFor(runId: string): RunCredentials {
    const credentials = apply(mapGet, this.#runCredentials, [runId]) as RunCredentials | undefined;
    if (!credentials) throw new Error("Current worker claim authority is required");
    return credentials;
  }

  async appendRunEvents(input: AppendExternalAgentWorkerRunEventsInput): Promise<void> {
    const credentials = this.#credentialsFor(input.runId);
    const route = terminalRoute(credentials.run_terminal_token, input.runId);
    await this.#request(
      `/runs/${route.id}/events`,
      lazySchema(defineSchema((v) => v.unknown())),
      {
        method: "POST",
        headers: { Authorization: `Bearer ${credentials.run_event_token}` },
        body: JSON.stringify({
          events: input.events,
          expected_previous_external_event_sequence: input.expectedPreviousExternalEventSequence,
        }),
      },
    );
  }

  async completeRun(input: CompleteExternalAgentWorkerRunInput): Promise<void> {
    const credentials = this.#credentialsFor(input.runId);
    await finalizeConversationAgentRun({
      ...input,
      authToken: credentials.auth_token,
      terminalAuthToken: credentials.run_terminal_token,
      apiUrl: this.#apiUrl,
      conversationId: "",
      provider: "",
      model: "",
      fetch: this.#fetch,
    });
    if (apply(mapGet, this.#runCredentials, [input.runId]) === credentials) {
      apply(mapDelete, this.#runCredentials, [input.runId]);
    }
  }
}

/** Create external agent worker client. */
export function createExternalAgentWorkerClient(
  options: ExternalAgentWorkerClientOptions,
): ExternalAgentWorkerClient {
  return new DefaultExternalAgentWorkerClient(options);
}
