import {
  type AgentProjectConfigProjection,
  parseRenderProjectConfigProjection,
  type RenderProjectConfigProjection,
  type StyleProjectConfigProjection,
} from "./project-config-worker-runtime.ts";
import {
  assertValidProjectConfigWorkerRequest,
  assertValidProjectConfigWorkerResponse,
  PROJECT_CONFIG_WORKER_PROTOCOL_VERSION,
  type ProjectConfigProjectionKind,
  type ProjectConfigWorkerRequest,
  type ProjectConfigWorkerResponse,
} from "./project-config-worker-contract.ts";
import type { ProjectConfigModule } from "./project-config-module.ts";
import type {
  AgentRunWorkerPreparationRequest,
  AgentRunWorkerPreparationResponse,
} from "./agent-run-worker-contract.ts";

const DEFAULT_PROJECT_CONFIG_WORKER_TIMEOUT_MS = 10_000;

type ProjectConfigProjectionByKind = {
  agent: AgentProjectConfigProjection;
  style: StyleProjectConfigProjection;
  render: RenderProjectConfigProjection;
};

type ConfigWorkerOptions = WorkerOptions & {
  deno?: {
    permissions: {
      read: false;
      write: false;
      net: false;
      env: false;
      run: false;
      ffi: false;
      sys: false;
    };
  };
};

export class ProjectConfigWorkerError extends Error {
  constructor(message = "Remote project config evaluation failed") {
    super(message);
    this.name = "ProjectConfigWorkerError";
  }
}

export interface EvaluateProjectConfigProjectionInput<
  K extends ProjectConfigProjectionKind,
> {
  requestId: string;
  sourceDigest: string;
  projectionKind: K;
  configModule?: ProjectConfigModule;
  timeoutMs?: number;
  /** Test-only entrypoint override. */
  workerScriptUrl?: string;
}

function configWorkerOptions(): ConfigWorkerOptions {
  return {
    type: "module",
    name: `project-config-worker-${crypto.randomUUID()}`,
    deno: {
      permissions: {
        read: false,
        write: false,
        net: false,
        env: false,
        run: false,
        ffi: false,
        sys: false,
      },
    },
  };
}

/**
 * Evaluate one project config in a disposable, secret-free Worker and return
 * only the requested plain-data projection. The Worker is never reused.
 */
export function evaluateProjectConfigProjectionIsolated<
  K extends ProjectConfigProjectionKind,
>(
  input: EvaluateProjectConfigProjectionInput<K>,
): Promise<ProjectConfigProjectionByKind[K]> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_PROJECT_CONFIG_WORKER_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new TypeError("Project config Worker timeout must be positive"));
  }
  const request: ProjectConfigWorkerRequest = structuredClone({
    type: "project-config-projection",
    schemaVersion: PROJECT_CONFIG_WORKER_PROTOCOL_VERSION,
    requestId: input.requestId,
    sourceDigest: input.sourceDigest,
    projectionKind: input.projectionKind,
    ...(input.configModule === undefined ? {} : { configModule: input.configModule }),
  });
  assertValidProjectConfigWorkerRequest(request);

  return new Promise<ProjectConfigProjectionByKind[K]>((resolve, reject) => {
    const worker = new Worker(
      input.workerScriptUrl ?? import.meta.resolve("./project-config-worker-script.ts"),
      configWorkerOptions(),
    );
    const responseChannel = new MessageChannel();
    let settled = false;
    const timer = setTimeout(() => {
      fail(new ProjectConfigWorkerError("Remote project config evaluation timed out"));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      responseChannel.port1.close();
      try {
        worker.terminate();
      } catch {
        // The disposable Worker may already have closed itself.
      }
    }

    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    responseChannel.port1.onmessage = (event: MessageEvent<unknown>) => {
      if (settled) return;
      try {
        const response = event.data as ProjectConfigWorkerResponse;
        assertValidProjectConfigWorkerResponse(response, request);
        if (response.type !== "project-config-projection-result") {
          fail(new ProjectConfigWorkerError());
          return;
        }
        const projection = input.projectionKind === "render"
          ? parseRenderProjectConfigProjection(response.projection)
          : structuredClone(response.projection);
        settled = true;
        cleanup();
        resolve(projection as ProjectConfigProjectionByKind[K]);
      } catch {
        fail(new ProjectConfigWorkerError("Remote project config Worker protocol failed"));
      }
    };
    responseChannel.port1.onmessageerror = () => {
      fail(new ProjectConfigWorkerError("Remote project config Worker protocol failed"));
    };
    responseChannel.port1.start();

    worker.onmessage = () => {
      fail(new ProjectConfigWorkerError("Remote project config used an untrusted channel"));
    };
    worker.onmessageerror = () => {
      fail(new ProjectConfigWorkerError("Remote project config Worker protocol failed"));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail(new ProjectConfigWorkerError());
    };

    try {
      worker.postMessage({
        type: "initialize-project-config-worker",
        responsePort: responseChannel.port2,
      }, { transfer: [responseChannel.port2] });
      worker.postMessage(request);
    } catch {
      fail(new ProjectConfigWorkerError("Remote project config Worker could not start"));
    }
  });
}

/** Adapter used by the agent bundle builder's config preparation stage. */
export async function prepareAgentRunConfigInDisposableWorker(
  request: AgentRunWorkerPreparationRequest,
): Promise<AgentRunWorkerPreparationResponse> {
  const projection = await evaluateProjectConfigProjectionIsolated({
    requestId: request.preparationId,
    sourceDigest: request.sourceDigest,
    projectionKind: "agent",
    configModule: request.configModule,
  });
  return {
    type: "agent-run-prepared",
    schemaVersion: request.schemaVersion,
    preparationId: request.preparationId,
    sourceDigest: request.sourceDigest,
    projection,
  };
}
