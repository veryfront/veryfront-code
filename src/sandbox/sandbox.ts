/**
 * Sandbox client for isolated workspaces.
 *
 * Runs commands and manages files in temporary or persistent sandboxes.
 *
 * @module
 */

import {
  assertSandboxFilesWritten,
  parseSandboxBackgroundCommand,
  parseSandboxBackgroundCommandOutput,
  parseSandboxCapabilities,
  parseSandboxCommandResult,
  parseSandboxDetails,
  parseSandboxEnvironment,
  parseSandboxFileList,
  parseSandboxRuntimeCheck,
  readSandboxCommandPages,
} from "./response.ts";
import { buildSandboxCommandOptions, buildSandboxCreateInput } from "./create-input.ts";
import { INITIALIZATION_ERROR, REQUEST_ERROR, TIMEOUT_ERROR } from "#veryfront/errors";
import { LazySandbox, type LazySandboxOptions } from "./lazy-sandbox.ts";
import { fetchSandboxUrl, resolveSandboxApiUrl, resolveSandboxAuthToken } from "./config.ts";
import { readSandboxFileContent, sandboxSessionRoute } from "./proxy-routes.ts";
import { readCommandStreamEvents } from "./exec-stream.ts";
import type {
  BackgroundCommand,
  BackgroundCommandOutput,
  CommandOptions,
  CommandResult,
  CommandStreamEvent,
  SandboxAttachment,
  SandboxCapabilities,
  SandboxClientOptions,
  SandboxDetails,
  SandboxEnvironment,
  SandboxFileListOptions,
  SandboxFileListResult,
  SandboxLifetimeInput,
  SandboxListOptions,
  SandboxListResult,
  SandboxOptions,
  SandboxRuntimeCheck,
} from "./types.ts";
export { resolveSandboxApiUrl, resolveSandboxAuthToken } from "./config.ts";
export type {
  BackgroundCommand,
  BackgroundCommandHeartbeatStatus,
  BackgroundCommandOutput,
  BackgroundCommandStatus,
  CommandOptions,
  CommandResult,
  CommandStreamEvent,
  SandboxAccessScope,
  SandboxAttachment,
  SandboxCapabilities,
  SandboxClientOptions,
  SandboxDetails,
  SandboxEnvironment,
  SandboxFileEntry,
  SandboxFileListOptions,
  SandboxFileListResult,
  SandboxLifetimeInput,
  SandboxLifetimeMode,
  SandboxListOptions,
  SandboxListResult,
  SandboxOptions,
  SandboxRuntimeCheck,
  SandboxStatus,
  SandboxWorkspaceStorage,
} from "./types.ts";

interface SandboxPrivateState {
  endpoint: string;
  sessionId: string;
  authToken: string;
  apiUrl: string;
  deleteOnClose: boolean;
}

const sandboxPrivateStates = new WeakMap<object, SandboxPrivateState>();
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;
const applyIntrinsic = Reflect.apply;

function getSandboxPrivateState(sandbox: Sandbox): SandboxPrivateState {
  const state = applyIntrinsic(weakMapGet, sandboxPrivateStates, [sandbox]) as
    | SandboxPrivateState
    | undefined;
  if (!state) throw new TypeError("Sandbox private state is unavailable");
  return state;
}

function getSandboxAuthToken(sandbox: Sandbox): string {
  return getSandboxPrivateState(sandbox).authToken;
}

/** Client for isolated ephemeral compute environments with command execution and file I/O. */
export class Sandbox {
  private constructor(
    endpoint: string,
    sessionId: string,
    authToken: string,
    apiUrl: string,
    deleteOnClose = true,
  ) {
    applyIntrinsic(weakMapSet, sandboxPrivateStates, [this, {
      endpoint,
      sessionId,
      authToken,
      apiUrl,
      deleteOnClose,
    }]);
  }

  /** Create an isolated sandbox. */
  static async create(options: SandboxOptions = {}): Promise<Sandbox> {
    const apiUrl = resolveSandboxApiUrl(options);
    const authToken = resolveSandboxAuthToken(options);

    const res = await fetchSandboxUrl(`${apiUrl}/sandboxes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildSandboxCreateInput(options)),
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Failed to create sandbox: ${res.status} ${await res.text()}`,
      });
    }

    const { id, endpoint, status } = await res.json();

    // If not yet running, poll until ready
    if (status !== "running") {
      await Sandbox.#waitForReady(apiUrl, id, authToken);
    }

    return new Sandbox(endpoint, id, authToken, apiUrl, options.ttlMode !== "always_on");
  }

  /** Connect to an existing sandbox. Closing this client leaves the sandbox available. */
  static async get(id: string, options: SandboxClientOptions = {}): Promise<Sandbox> {
    const apiUrl = resolveSandboxApiUrl(options);
    const authToken = resolveSandboxAuthToken(options);

    const res = await fetchSandboxUrl(`${apiUrl}/sandboxes/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Failed to get sandbox: ${res.status} ${await res.text()}`,
      });
    }

    const { endpoint } = await res.json();
    return new Sandbox(endpoint, id, authToken, apiUrl, false);
  }

  /** Attach to an existing sandbox. Closing detaches; use delete() to remove it. */
  static attach(attachment: SandboxAttachment): Sandbox {
    const apiUrl = resolveSandboxApiUrl(attachment);
    const authToken = resolveSandboxAuthToken(attachment);
    return new Sandbox(attachment.endpoint, attachment.id, authToken, apiUrl, false);
  }

  /** Get sandbox capabilities, limits and defaults for the current caller. */
  static async capabilities(options: SandboxClientOptions = {}): Promise<SandboxCapabilities> {
    return parseSandboxCapabilities(
      await requestSandboxControlPlane(
        resolveSandboxApiUrl(options),
        resolveSandboxAuthToken(options),
        "/sandboxes/capabilities",
      ),
    );
  }

  /** Check runtime health without recording activity. */
  async checkHealth(): Promise<SandboxRuntimeCheck> {
    return parseSandboxRuntimeCheck(await this.#requestControlPlane("/healthz"));
  }

  /** Check command readiness without recording activity. */
  async checkReadiness(): Promise<SandboxRuntimeCheck> {
    return parseSandboxRuntimeCheck(await this.#requestControlPlane("/readyz"));
  }

  /** Get environment variable names with redacted values. */
  async getEnvironment(): Promise<SandboxEnvironment> {
    return parseSandboxEnvironment(await this.#requestControlPlane("/environment"));
  }

  /** Read one directory page. Supply pageInfo.next as cursor for another page. */
  async listFiles(options: SandboxFileListOptions = {}): Promise<SandboxFileListResult> {
    const params = new URLSearchParams({ path: options.path ?? "/workspace" });
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    return parseSandboxFileList(await this.#requestControlPlane(`/files?${params}`));
  }

  /** Update cleanup policy without changing access or storage. */
  async updateLifetime(input: SandboxLifetimeInput): Promise<SandboxDetails> {
    const policy = buildSandboxCreateInput(input);
    const details = parseSandboxDetails(
      await this.#requestControlPlane("", {
        method: "PATCH",
        body: JSON.stringify({
          ttl_mode: policy.ttl_mode,
          ...(policy.ttl_hours !== undefined ? { ttl_hours: policy.ttl_hours } : {}),
        }),
      }),
    );
    const state = getSandboxPrivateState(this);
    state.deleteOnClose = state.deleteOnClose && details.workspaceStorage !== "persistent" &&
      details.ttlMode !== "always_on";
    return details;
  }

  #requestControlPlane(path: string, init?: RequestInit): Promise<unknown> {
    const state = getSandboxPrivateState(this);
    return requestSandboxControlPlane(
      state.apiUrl,
      getSandboxAuthToken(this),
      `/sandboxes/${encodeURIComponent(state.sessionId)}${path}`,
      init,
    );
  }

  /** List sandboxes with optional pagination. */
  static async list(options: SandboxListOptions = {}): Promise<SandboxListResult> {
    const apiUrl = resolveSandboxApiUrl(options);
    const authToken = resolveSandboxAuthToken(options);

    const params = new URLSearchParams();
    const projectReference = options.projectReference;
    if (projectReference) params.set("project_reference", projectReference);
    if (options.accessScope) params.set("access_scope", options.accessScope);
    if (options.sortBy) params.set("sort_by", options.sortBy);
    if (options.sortOrder) params.set("sort_order", options.sortOrder);
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.limit !== undefined) params.set("limit", String(options.limit));

    const query = params.toString();
    const url = `${apiUrl}/sandboxes${query ? `?${query}` : ""}`;

    const res = await fetchSandboxUrl(url, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Failed to list sandboxes: ${res.status} ${await res.text()}`,
      });
    }

    const json = await res.json();

    return {
      data: json.data.map(parseSandboxDetails),
      pageInfo: {
        self: json.page_info?.self ?? null,
        first: null,
        next: json.page_info?.next ?? null,
        prev: json.page_info?.prev ?? null,
      },
    };
  }

  static async #waitForReady(
    apiUrl: string,
    id: string,
    authToken: string,
    maxWaitMs = 60_000,
    pollIntervalMs = 2_000,
  ): Promise<void> {
    await waitForSandboxReady({ apiUrl, id, authToken, maxWaitMs, pollIntervalMs });
  }

  /** Create a client that provisions its sandbox when first used. */
  static createLazy(options: LazySandboxOptions = {}): LazySandbox {
    return new LazySandbox(options);
  }

  /** Execute a bash command in the sandbox and return buffered result. */
  async runCommand(command: string, options?: CommandOptions): Promise<CommandResult> {
    return parseSandboxCommandResult(
      await this.#requestControlPlane("/commands/run", {
        method: "POST",
        body: JSON.stringify({ command, ...buildSandboxCommandOptions(options) }),
      }),
    );
  }

  /** Execute a bash command with streaming output (NDJSON). */
  async *streamCommand(
    command: string,
    options?: CommandOptions,
  ): AsyncGenerator<CommandStreamEvent> {
    const res = await fetchSandboxUrl(
      sandboxSessionRoute(
        getSandboxPrivateState(this).apiUrl,
        getSandboxPrivateState(this).sessionId,
        "/commands/stream",
      ),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getSandboxAuthToken(this)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ command, ...buildSandboxCommandOptions(options) }),
      },
    );

    if (!res.ok) {
      throw REQUEST_ERROR.create({ detail: `Exec failed: ${res.status} ${await res.text()}` });
    }

    if (!res.body) {
      throw new Error("Exec response has no body");
    }
    yield* readCommandStreamEvents(res.body);
  }

  /** Read a file from the sandbox workspace. */
  async readFile(path: string): Promise<string> {
    const res = await fetchSandboxUrl(
      sandboxSessionRoute(
        getSandboxPrivateState(this).apiUrl,
        getSandboxPrivateState(this).sessionId,
        `/file?path=${encodeURIComponent(path)}`,
      ),
      {
        headers: { Authorization: `Bearer ${getSandboxAuthToken(this)}` },
      },
    );

    if (!res.ok) {
      throw REQUEST_ERROR.create({ detail: `Read file failed: ${res.status} ${await res.text()}` });
    }

    return await readSandboxFileContent(res);
  }

  /** Write files to the sandbox workspace. */
  async writeFiles(
    files: Array<{ path: string; content: string }>,
  ): Promise<void> {
    const state = getSandboxPrivateState(this);
    const res = await fetchSandboxUrl(
      sandboxSessionRoute(state.apiUrl, state.sessionId, "/files"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getSandboxAuthToken(this)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ files }),
      },
    );

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Write files failed: ${res.status} ${await res.text()}`,
      });
    }
    assertSandboxFilesWritten(await res.json(), files.map((file) => file.path));
  }

  /** Start an async background command in the sandbox. */
  async startBackgroundCommand(
    command: string,
    options?: CommandOptions,
  ): Promise<BackgroundCommand> {
    const res = await fetchSandboxUrl(
      sandboxSessionRoute(
        getSandboxPrivateState(this).apiUrl,
        getSandboxPrivateState(this).sessionId,
        "/commands",
      ),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getSandboxAuthToken(this)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ command, ...buildSandboxCommandOptions(options) }),
      },
    );

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Start background command failed: ${res.status} ${await res.text()}`,
      });
    }

    return Sandbox.mapBackgroundCommand(await res.json());
  }

  /** Get the status of an async background command. */
  async getBackgroundCommand(commandId: string): Promise<BackgroundCommand> {
    const res = await fetchSandboxUrl(
      sandboxSessionRoute(
        getSandboxPrivateState(this).apiUrl,
        getSandboxPrivateState(this).sessionId,
        `/commands/${encodeURIComponent(commandId)}`,
      ),
      {
        headers: { Authorization: `Bearer ${getSandboxAuthToken(this)}` },
      },
    );

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Get background command failed: ${res.status} ${await res.text()}`,
      });
    }

    return Sandbox.mapBackgroundCommand(await res.json());
  }

  /** Get the output of an async background command. */
  async getBackgroundCommandOutput(commandId: string): Promise<BackgroundCommandOutput> {
    const res = await fetchSandboxUrl(
      sandboxSessionRoute(
        getSandboxPrivateState(this).apiUrl,
        getSandboxPrivateState(this).sessionId,
        `/commands/${encodeURIComponent(commandId)}/output`,
      ),
      {
        headers: { Authorization: `Bearer ${getSandboxAuthToken(this)}` },
      },
    );

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Get background command output failed: ${res.status} ${await res.text()}`,
      });
    }

    const json = await res.json();
    return parseSandboxBackgroundCommandOutput(json);
  }

  /** List all background commands in the sandbox. */
  async listBackgroundCommands(): Promise<BackgroundCommand[]> {
    const commands = await readSandboxCommandPages(async (cursor) => {
      const state = getSandboxPrivateState(this);
      const path = `/commands${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
      const response = await fetchSandboxUrl(
        sandboxSessionRoute(state.apiUrl, state.sessionId, path),
        { headers: { Authorization: `Bearer ${getSandboxAuthToken(this)}` } },
      );
      if (!response.ok) {
        throw REQUEST_ERROR.create({
          detail: `List background commands failed: ${response.status}`,
        });
      }
      return response.json();
    });
    return commands.map((command) => Sandbox.mapBackgroundCommand(command));
  }

  /** Cancel an async background command. */
  async cancelBackgroundCommand(commandId: string): Promise<BackgroundCommand> {
    const res = await fetchSandboxUrl(
      sandboxSessionRoute(
        getSandboxPrivateState(this).apiUrl,
        getSandboxPrivateState(this).sessionId,
        `/commands/${encodeURIComponent(commandId)}/cancel`,
      ),
      {
        method: "POST",
        headers: { Authorization: `Bearer ${getSandboxAuthToken(this)}` },
      },
    );

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Cancel background command failed: ${res.status} ${await res.text()}`,
      });
    }

    return Sandbox.mapBackgroundCommand(await res.json());
  }

  private static mapBackgroundCommand(json: Record<string, unknown>): BackgroundCommand {
    return parseSandboxBackgroundCommand(json);
  }

  /** Send a heartbeat to prevent idle timeout. */
  async heartbeat(): Promise<void> {
    const res = await fetchSandboxUrl(
      `${getSandboxPrivateState(this).apiUrl}/sandboxes/${
        encodeURIComponent(getSandboxPrivateState(this).sessionId)
      }/heartbeat`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${getSandboxAuthToken(this)}` },
      },
    );

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Sandbox heartbeat failed: ${res.status} ${await res.text()}`,
      });
    }
  }

  /** Close this client. Always-on workspaces remain available. */
  async close(): Promise<void> {
    if (getSandboxPrivateState(this).deleteOnClose) await this.delete();
  }

  /** Delete the sandbox and its workspace files. */
  async delete(): Promise<void> {
    const res = await fetchSandboxUrl(
      `${getSandboxPrivateState(this).apiUrl}/sandboxes/${
        encodeURIComponent(getSandboxPrivateState(this).sessionId)
      }`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getSandboxAuthToken(this)}` },
      },
    );

    if (!res.ok) {
      throw REQUEST_ERROR.create({
        detail: `Delete sandbox failed: ${res.status} ${await res.text()}`,
      });
    }
  }

  /** Get the sandbox ID. */
  get id(): string {
    return getSandboxPrivateState(this).sessionId;
  }

  /** Get the sandbox endpoint URL. */
  get url(): string {
    return getSandboxPrivateState(this).endpoint;
  }
}

export async function waitForSandboxReady(input: {
  apiUrl: string;
  id: string;
  authToken: string;
  maxWaitMs?: number;
  pollIntervalMs?: number;
}): Promise<void> {
  const maxWaitMs = input.maxWaitMs ?? 60_000;
  const pollIntervalMs = input.pollIntervalMs ?? 2_000;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

    const res = await fetchSandboxUrl(
      `${input.apiUrl}/sandboxes/${encodeURIComponent(input.id)}`,
      {
        headers: { Authorization: `Bearer ${input.authToken}` },
      },
    );

    if (!res.ok) {
      continue;
    }

    const data = await res.json();
    if (data.status === "running") return;
    if (data.status === "error" || data.status === "deleting") {
      throw INITIALIZATION_ERROR.create({
        detail: `Sandbox failed to start: status=${data.status}`,
      });
    }
  }

  throw TIMEOUT_ERROR.create({ detail: "Sandbox did not become ready within timeout" });
}

async function requestSandboxControlPlane(
  apiUrl: string,
  authToken: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetchSandboxUrl(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${authToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok) {
    throw REQUEST_ERROR.create({ detail: `Sandbox request failed: ${response.status}` });
  }
  return response.json();
}
