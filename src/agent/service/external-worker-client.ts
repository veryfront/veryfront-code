import type { Schema, SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { defineSchema } from "../../schemas/define.ts";
import { lazySchema } from "../../schemas/lazy.ts";
import { NETWORK_ERROR } from "#veryfront/errors";

/** Public API contract for external agent worker. */
export interface ExternalAgentWorker {
  /** Resource identifier. */
  id: string;
  /** Project identifier. */
  project_id: string;
  /** Implementation kind value. */
  implementation_kind: string;
  /** Worker key value. */
  worker_key: string;
  /** Display name. */
  display_name?: string | null;
  /** Status. */
  status?: string;
  /** Additional structured metadata. */
  metadata?: unknown | null;
  /** Last heartbeat timestamp. */
  last_heartbeat_at?: string | null;
  /** Created timestamp. */
  created_at?: string;
  /** Updated timestamp. */
  updated_at?: string;
}

/** Public API contract for external agent worker request snapshot. */
export interface ExternalAgentWorkerRequestSnapshot {
  /** Messages associated with the operation. */
  messages: Array<{
    id: string;
    role: string;
    parts: Array<{ type: string } & Record<string, unknown>>;
    metadata?: Record<string, unknown>;
    createdAt?: string;
  }>;
  /** Tools value. */
  tools: unknown[];
  /** Context supplied to the operation. */
  context: unknown[];
  /** Forwarded props value. */
  forwardedProps?: Record<string, unknown>;
  /** Trace context value. */
  traceContext?: unknown;
}

/** Public API contract for external agent worker session. */
export interface ExternalAgentWorkerSession {
  /** Resource identifier. */
  id: string;
  /** Run identifier. */
  run_id: string;
  /** Implementation kind value. */
  implementation_kind: string;
  /** Worker identifier. */
  worker_id: string | null;
  /** Session key value. */
  session_key: string;
  /** Status. */
  status: string;
  /** Additional structured metadata. */
  metadata?: unknown | null;
  /** Created timestamp. */
  created_at?: string;
  /** Updated timestamp. */
  updated_at?: string;
  /** Ended timestamp. */
  ended_at?: string | null;
}

/** Public API contract for external agent worker run. */
export interface ExternalAgentWorkerRun {
  /** Run identifier. */
  run_id: string;
  /** Conversation identifier. */
  conversation_id: string;
  /** Message identifier. */
  message_id: string;
  /** Project identifier. */
  project_id: string | null;
  /** Agent identifier. */
  agent_id: string;
  /** Status. */
  status: string;
  /** Request snapshot value. */
  request_snapshot: ExternalAgentWorkerRequestSnapshot | null;
  /** Source target kind value. */
  source_target_kind?: string | null;
  /** Source target environment identifier. */
  source_target_environment_id?: string | null;
  /** Source target branch identifier. */
  source_target_branch_id?: string | null;
  /** Source target release version value. */
  source_target_release_version?: string | null;
  /** Runtime target kind value. */
  runtime_target_kind?: string | null;
  /** Runtime target environment identifier. */
  runtime_target_environment_id?: string | null;
  /** Runtime target branch identifier. */
  runtime_target_branch_id?: string | null;
  /** Latest event identifier. */
  latest_event_id: number;
  /** Latest external event sequence value. */
  latest_external_event_sequence: number;
  /** Lease owner value. */
  lease_owner: string | null;
  /** Lease expires timestamp. */
  lease_expires_at: string | null;
  /** Worker session value. */
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
export const ExternalAgentWorkerSchema: Schema<ExternalAgentWorker> = lazySchema(
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
    messages: v.array(externalAgentWorkerRequestMessage(v)),
    tools: v.array(v.unknown()).default([]),
    context: v.array(v.unknown()).default([]),
    forwardedProps: v.record(v.string(), v.unknown()).optional(),
    traceContext: v.unknown().optional(),
  });
}

/** Zod schema for external agent worker request snapshot. */
export const ExternalAgentWorkerRequestSnapshotSchema: Schema<ExternalAgentWorkerRequestSnapshot> =
  lazySchema(
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
export const ExternalAgentWorkerSessionSchema: Schema<ExternalAgentWorkerSession> = lazySchema(
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
export const ExternalAgentWorkerRunSchema: Schema<ExternalAgentWorkerRun> = lazySchema(
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

/** Options accepted by external agent worker client. */
export interface ExternalAgentWorkerClientOptions {
  /** Base URL for Veryfront API requests. */
  apiUrl: string;
  /** Bearer token used for authenticated API requests. */
  authToken: string;
  /** Fetch implementation used for API requests. */
  fetch?: typeof fetch;
}

/** Input payload for register external agent worker. */
export interface RegisterExternalAgentWorkerInput {
  /** Project reference value. */
  projectReference: string;
  /** Implementation kind value. */
  implementationKind: string;
  /** Implementation display name value. */
  implementationDisplayName: string;
  /** Worker key value. */
  workerKey: string;
  /** Display name value. */
  displayName?: string;
  /** Additional structured metadata. */
  metadata?: Record<string, unknown>;
}

/** Input payload for claim external agent worker run. */
export interface ClaimExternalAgentWorkerRunInput {
  /** Worker ID value. */
  workerId: string;
  /** Lease duration seconds value. */
  leaseDurationSeconds: number;
}

/** Input payload for record external agent worker session. */
export interface RecordExternalAgentWorkerSessionInput {
  /** Worker ID value. */
  workerId: string;
  /** Run ID value. */
  runId: string;
  /** Session key value. */
  sessionKey: string;
  /** Status. */
  status?: "active" | "completed" | "failed" | "cancelled";
  /** Additional structured metadata. */
  metadata?: Record<string, unknown>;
}

/** Input payload for complete external agent worker run. */
export interface CompleteExternalAgentWorkerRunInput {
  /** Run ID value. */
  runId: string;
  /** Status. */
  status: "completed" | "failed" | "cancelled";
  /** Terminal error code value. */
  terminalErrorCode?: string;
  /** Terminal error message value. */
  terminalErrorMessage?: string;
}

/** Input payload for append external agent worker run events. */
export interface AppendExternalAgentWorkerRunEventsInput {
  /** Conversation ID value. */
  conversationId: string;
  /** Run ID value. */
  runId: string;
  /** Events value. */
  events: unknown[];
  /** Expected previous external event sequence value. */
  expectedPreviousExternalEventSequence?: number;
}

/** Public API contract for external agent worker client. */
export interface ExternalAgentWorkerClient {
  /** Performs the register worker operation. */
  registerWorker(input: RegisterExternalAgentWorkerInput): Promise<ExternalAgentWorker>;
  /** Performs the heartbeat worker operation. */
  heartbeatWorker(workerId: string): Promise<ExternalAgentWorker>;
  /** Performs the claim run operation. */
  claimRun(input: ClaimExternalAgentWorkerRunInput): Promise<ExternalAgentWorkerRun | null>;
  /** Performs the renew lease operation. */
  renewLease(input: ClaimExternalAgentWorkerRunInput & { runId: string }): Promise<
    ExternalAgentWorkerRun | null
  >;
  /** Records session. */
  recordSession(input: RecordExternalAgentWorkerSessionInput): Promise<
    ExternalAgentWorkerSession
  >;
  /** Appends run events. */
  appendRunEvents(input: AppendExternalAgentWorkerRunEventsInput): Promise<void>;
  /** Performs the complete run operation. */
  completeRun(input: CompleteExternalAgentWorkerRunInput): Promise<void>;
}

class DefaultExternalAgentWorkerClient implements ExternalAgentWorkerClient {
  readonly #apiUrl: string;
  readonly #authToken: string;
  readonly #fetch: typeof fetch;
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
      lazySchema(
        defineSchema<{ run: ExternalAgentWorkerRun | null }>((v) =>
          v.object({ run: externalAgentWorkerRun(v).nullable() })
        ),
      ),
      {
        method: "POST",
        body: JSON.stringify({ lease_duration_seconds: input.leaseDurationSeconds }),
      },
      { workerId: input.workerId },
    );
    return response.run;
  }

  async renewLease(
    input: ClaimExternalAgentWorkerRunInput & { runId: string },
  ): Promise<ExternalAgentWorkerRun | null> {
    const response = await this.#request(
      `/agent-workers/workers/${encodeURIComponent(input.workerId)}/runs/${
        encodeURIComponent(input.runId)
      }/lease`,
      lazySchema(
        defineSchema<{ run: ExternalAgentWorkerRun | null }>((v) =>
          v.object({ run: externalAgentWorkerRun(v).nullable() })
        ),
      ),
      {
        method: "POST",
        body: JSON.stringify({ lease_duration_seconds: input.leaseDurationSeconds }),
      },
      { workerId: input.workerId },
    );
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

  async appendRunEvents(input: AppendExternalAgentWorkerRunEventsInput): Promise<void> {
    await this.#request(
      `/conversations/${encodeURIComponent(input.conversationId)}/runs/${
        encodeURIComponent(input.runId)
      }/events`,
      lazySchema(defineSchema((v) => v.unknown())),
      {
        method: "POST",
        body: JSON.stringify({
          events: input.events,
          expected_previous_external_event_sequence: input.expectedPreviousExternalEventSequence,
        }),
      },
    );
  }

  async completeRun(input: CompleteExternalAgentWorkerRunInput): Promise<void> {
    await this.#request(
      `/runs/${encodeURIComponent(input.runId)}/complete`,
      lazySchema(defineSchema((v) => v.unknown())),
      {
        method: "POST",
        body: JSON.stringify({
          status: input.status,
          terminal_error_code: input.terminalErrorCode,
          terminal_error_message: input.terminalErrorMessage,
        }),
      },
    );
  }
}

/** Create external agent worker client. */
export function createExternalAgentWorkerClient(
  options: ExternalAgentWorkerClientOptions,
): ExternalAgentWorkerClient {
  return new DefaultExternalAgentWorkerClient(options);
}
