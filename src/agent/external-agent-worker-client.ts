import { z } from "zod";

export const ExternalAgentWorkerSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  implementation_kind: z.string(),
  worker_key: z.string(),
  display_name: z.string().nullable().optional(),
  status: z.string().optional(),
  metadata: z.unknown().nullable().optional(),
  last_heartbeat_at: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

const ExternalAgentWorkerRequestMessageSchema = z.object({
  id: z.string(),
  role: z.string(),
  parts: z.array(z.object({ type: z.string() }).passthrough()).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().optional(),
});

export const ExternalAgentWorkerRequestSnapshotSchema = z.object({
  messages: z.array(ExternalAgentWorkerRequestMessageSchema),
  tools: z.array(z.unknown()).default([]),
  context: z.array(z.unknown()).default([]),
  forwardedProps: z.record(z.string(), z.unknown()).optional(),
  traceContext: z.unknown().optional(),
});

export const ExternalAgentWorkerSessionSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string(),
  implementation_kind: z.string(),
  worker_id: z.string().uuid().nullable(),
  session_key: z.string(),
  status: z.string(),
  metadata: z.unknown().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  ended_at: z.string().nullable().optional(),
});

export const ExternalAgentWorkerRunSchema = z.object({
  run_id: z.string(),
  conversation_id: z.string().uuid(),
  message_id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  agent_id: z.string(),
  status: z.string(),
  request_snapshot: ExternalAgentWorkerRequestSnapshotSchema.nullable(),
  source_target_kind: z.string().nullable().optional(),
  source_target_environment_id: z.string().uuid().nullable().optional(),
  source_target_branch_id: z.string().uuid().nullable().optional(),
  source_target_release_version: z.string().nullable().optional(),
  runtime_target_kind: z.string().nullable().optional(),
  runtime_target_environment_id: z.string().uuid().nullable().optional(),
  runtime_target_branch_id: z.string().uuid().nullable().optional(),
  latest_event_id: z.number(),
  latest_external_event_sequence: z.number(),
  lease_owner: z.string().nullable(),
  lease_expires_at: z.string().nullable(),
  worker_session: ExternalAgentWorkerSessionSchema.nullable().default(null),
});

const RegisterExternalAgentWorkerResponseSchema = z.object({
  worker: ExternalAgentWorkerSchema,
  token: z.string().min(1),
});

export type ExternalAgentWorker = z.infer<typeof ExternalAgentWorkerSchema>;
export type ExternalAgentWorkerRequestSnapshot = z.infer<
  typeof ExternalAgentWorkerRequestSnapshotSchema
>;
export type ExternalAgentWorkerRun = z.infer<typeof ExternalAgentWorkerRunSchema>;
export type ExternalAgentWorkerSession = z.infer<
  typeof ExternalAgentWorkerSessionSchema
>;

export interface ExternalAgentWorkerClientOptions {
  apiUrl: string;
  authToken: string;
  fetch?: typeof fetch;
}

export interface RegisterExternalAgentWorkerInput {
  projectReference: string;
  implementationKind: string;
  implementationDisplayName: string;
  workerKey: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
}

export interface ClaimExternalAgentWorkerRunInput {
  workerId: string;
  leaseDurationSeconds: number;
}

export interface RecordExternalAgentWorkerSessionInput {
  workerId: string;
  runId: string;
  sessionKey: string;
  status?: "active" | "completed" | "failed" | "cancelled";
  metadata?: Record<string, unknown>;
}

export interface CompleteExternalAgentWorkerRunInput {
  runId: string;
  status: "completed" | "failed" | "cancelled";
  terminalErrorCode?: string;
  terminalErrorMessage?: string;
}

export interface AppendExternalAgentWorkerRunEventsInput {
  conversationId: string;
  runId: string;
  events: unknown[];
  expectedPreviousExternalEventSequence?: number;
}

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
  readonly #workerTokensByWorkerId = new Map<string, string>();

  constructor(options: ExternalAgentWorkerClientOptions) {
    this.#apiUrl = options.apiUrl.replace(/\/$/, "");
    this.#authToken = options.authToken;
    this.#fetch = options.fetch ?? fetch;
  }

  async #request<S extends z.ZodTypeAny>(
    path: string,
    schema: S,
    init: RequestInit = {},
    options: { workerId?: string } = {},
  ): Promise<z.output<S>> {
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
      throw new Error(body || `Veryfront API returned HTTP ${response.status}`);
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
      z.object({ worker: ExternalAgentWorkerSchema }),
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
      z.object({ run: ExternalAgentWorkerRunSchema.nullable() }),
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
      z.object({ run: ExternalAgentWorkerRunSchema.nullable() }),
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
      z.object({ session: ExternalAgentWorkerSessionSchema }),
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
      z.unknown(),
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
      z.unknown(),
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

export function createExternalAgentWorkerClient(
  options: ExternalAgentWorkerClientOptions,
): ExternalAgentWorkerClient {
  return new DefaultExternalAgentWorkerClient(options);
}
