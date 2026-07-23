import type {
  AgentProjectConfigProjection,
  RenderProjectConfigProjection,
  StyleProjectConfigProjection,
} from "./project-config-worker-runtime.ts";
import {
  assertValidAgentProjectConfigProjection,
  assertValidRenderProjectConfigProjection,
  assertValidStyleProjectConfigProjection,
} from "./project-config-worker-runtime.ts";
import {
  assertValidProjectConfigModule,
  type ProjectConfigModule,
} from "./project-config-module.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const PROJECT_CONFIG_WORKER_PROTOCOL_VERSION = 1;
export type ProjectConfigProjectionKind = "agent" | "style" | "render";
export type ProjectConfigProjection =
  | AgentProjectConfigProjection
  | StyleProjectConfigProjection
  | RenderProjectConfigProjection;

export interface ProjectConfigWorkerRequest {
  type: "project-config-projection";
  schemaVersion: typeof PROJECT_CONFIG_WORKER_PROTOCOL_VERSION;
  requestId: string;
  sourceDigest: string;
  projectionKind: ProjectConfigProjectionKind;
  configModule?: ProjectConfigModule;
}

export interface ProjectConfigWorkerSuccess {
  type: "project-config-projection-result";
  schemaVersion: typeof PROJECT_CONFIG_WORKER_PROTOCOL_VERSION;
  requestId: string;
  sourceDigest: string;
  projectionKind: ProjectConfigProjectionKind;
  projection: ProjectConfigProjection;
}

export interface ProjectConfigWorkerFailure {
  type: "project-config-projection-error";
  schemaVersion: typeof PROJECT_CONFIG_WORKER_PROTOCOL_VERSION;
  requestId: string;
  sourceDigest: string;
  projectionKind: ProjectConfigProjectionKind;
  errorCode: "CONFIG_EVALUATION_FAILED";
}

export type ProjectConfigWorkerResponse =
  | ProjectConfigWorkerSuccess
  | ProjectConfigWorkerFailure;

function assertIdentity(value: {
  schemaVersion: number;
  requestId: string;
  sourceDigest: string;
  projectionKind: string;
}): void {
  if (value.schemaVersion !== PROJECT_CONFIG_WORKER_PROTOCOL_VERSION) {
    throw new TypeError("Project config Worker protocol version is invalid");
  }
  if (!UUID_PATTERN.test(value.requestId)) {
    throw new TypeError("Project config Worker request id is invalid");
  }
  if (!SHA256_PATTERN.test(value.sourceDigest)) {
    throw new TypeError("Project config Worker source digest is invalid");
  }
  if (
    value.projectionKind !== "agent" && value.projectionKind !== "style" &&
    value.projectionKind !== "render"
  ) {
    throw new TypeError("Project config Worker projection kind is invalid");
  }
}

export function assertValidProjectConfigWorkerRequest(
  value: ProjectConfigWorkerRequest,
): asserts value is ProjectConfigWorkerRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Project config Worker request is invalid");
  }
  if (value.type !== "project-config-projection") {
    throw new TypeError("Project config Worker request type is invalid");
  }
  assertIdentity(value);
  if (value.configModule !== undefined) assertValidProjectConfigModule(value.configModule);
}

function assertProjection(
  kind: ProjectConfigProjectionKind,
  projection: ProjectConfigProjection,
): void {
  if (kind === "agent") {
    assertValidAgentProjectConfigProjection(projection as AgentProjectConfigProjection);
  } else if (kind === "style") {
    assertValidStyleProjectConfigProjection(projection as StyleProjectConfigProjection);
  } else {
    assertValidRenderProjectConfigProjection(projection);
  }
}

export function assertValidProjectConfigWorkerResponse(
  value: ProjectConfigWorkerResponse,
  expected?: ProjectConfigWorkerRequest,
): asserts value is ProjectConfigWorkerResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Project config Worker response is invalid");
  }
  assertIdentity(value);
  if (
    expected && (
      value.requestId !== expected.requestId || value.sourceDigest !== expected.sourceDigest ||
      value.projectionKind !== expected.projectionKind
    )
  ) {
    throw new TypeError("Project config Worker response identity is invalid");
  }
  if (value.type === "project-config-projection-result") {
    assertProjection(value.projectionKind, value.projection);
    return;
  }
  if (
    value.type !== "project-config-projection-error" ||
    value.errorCode !== "CONFIG_EVALUATION_FAILED"
  ) {
    throw new TypeError("Project config Worker response type is invalid");
  }
}
