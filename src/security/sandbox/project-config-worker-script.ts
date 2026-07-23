import {
  createAgentProjectConfigProjection,
  createRenderProjectConfigProjection,
  createStyleProjectConfigProjection,
  evaluateProjectConfigModuleInWorker,
} from "./project-config-worker-runtime.ts";
import {
  assertValidProjectConfigWorkerRequest,
  PROJECT_CONFIG_WORKER_PROTOCOL_VERSION,
  type ProjectConfigWorkerFailure,
  type ProjectConfigWorkerRequest,
  type ProjectConfigWorkerSuccess,
} from "./project-config-worker-contract.ts";

type InitializeProjectConfigWorker = {
  type: "initialize-project-config-worker";
  responsePort: MessagePort;
};

const cloneForTransport = structuredClone.bind(globalThis);
const closeWorker = globalThis.close.bind(globalThis);
let initialized = false;
let requestAccepted = false;
let postConfigMessage: ((message: unknown) => void) | undefined;

function blockPublicWorkerMessaging(): void {
  const denied = () => {
    throw new DOMException("Project config cannot access the Worker transport", "SecurityError");
  };
  try {
    Object.defineProperty(self, "postMessage", {
      configurable: false,
      enumerable: true,
      get: () => denied,
      set: () => {},
    });
  } catch {
    // The host rejects every public-channel message, so shadowing failure is
    // still fail-closed.
  }
}

function isTrustedHostMessage(event: MessageEvent): boolean {
  return event.isTrusted && event.origin === "" && event.source === null &&
    event.currentTarget === self;
}

function projectConfigFailure(request: ProjectConfigWorkerRequest): ProjectConfigWorkerFailure {
  return {
    type: "project-config-projection-error",
    schemaVersion: PROJECT_CONFIG_WORKER_PROTOCOL_VERSION,
    requestId: request.requestId,
    sourceDigest: request.sourceDigest,
    projectionKind: request.projectionKind,
    errorCode: "CONFIG_EVALUATION_FAILED",
  };
}

async function evaluateRequest(request: ProjectConfigWorkerRequest): Promise<void> {
  try {
    assertValidProjectConfigWorkerRequest(request);
    const config = await evaluateProjectConfigModuleInWorker(request.configModule);
    const projection = request.projectionKind === "agent"
      ? createAgentProjectConfigProjection(config)
      : request.projectionKind === "style"
      ? createStyleProjectConfigProjection(config)
      : createRenderProjectConfigProjection(config);
    const response: ProjectConfigWorkerSuccess = {
      type: "project-config-projection-result",
      schemaVersion: PROJECT_CONFIG_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      sourceDigest: request.sourceDigest,
      projectionKind: request.projectionKind,
      projection: cloneForTransport(projection),
    };
    postConfigMessage?.(response);
  } catch {
    postConfigMessage?.(projectConfigFailure(request));
  } finally {
    closeWorker();
  }
}

function handleMessage(
  event: MessageEvent<InitializeProjectConfigWorker | ProjectConfigWorkerRequest>,
) {
  if (!isTrustedHostMessage(event)) return;
  const message = event.data;
  if (!initialized) {
    if (
      message?.type !== "initialize-project-config-worker" ||
      !(message.responsePort instanceof MessagePort)
    ) {
      closeWorker();
      return;
    }
    postConfigMessage = message.responsePort.postMessage.bind(message.responsePort);
    initialized = true;
    blockPublicWorkerMessaging();
    return;
  }

  if (requestAccepted || message?.type !== "project-config-projection") {
    closeWorker();
    return;
  }
  requestAccepted = true;
  void evaluateRequest(message);
}

self.addEventListener("message", handleMessage);
