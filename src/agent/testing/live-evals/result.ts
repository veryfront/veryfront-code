import type { LiveEvalRuntime } from "./performance.ts";

export interface LiveEvalResultRecord {
  id: string;
  label: string;
  runtime: LiveEvalRuntime;
  status: "pass" | "fail" | "skip";
  details: string;
  durationMs: number;
  conversationId?: string;
  runId?: string;
  artifactPaths?: string[];
  traceSignature?: string;
  toolStarts?: string[];
  toolArgsPreview?: string;
  textPreview?: string;
}

export function createSkippedEvalResult(input: {
  id: string;
  label: string;
  runtime: LiveEvalRuntime;
  details: string;
  startedAt: number;
}): LiveEvalResultRecord {
  return {
    id: input.id,
    label: input.label,
    runtime: input.runtime,
    status: "skip",
    details: input.details,
    durationMs: Date.now() - input.startedAt,
  };
}

export function createFailedEvalResult(input: {
  id: string;
  label: string;
  runtime: LiveEvalRuntime;
  details: string;
  startedAt: number;
  conversationId?: string;
  runId?: string;
  artifactPaths?: string[];
  traceSignature?: string;
  toolStarts?: string[];
  toolArgsPreview?: string;
  textPreview?: string;
}): LiveEvalResultRecord {
  return {
    id: input.id,
    label: input.label,
    runtime: input.runtime,
    status: "fail",
    details: input.details,
    durationMs: Date.now() - input.startedAt,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.artifactPaths?.length ? { artifactPaths: input.artifactPaths } : {}),
    ...(input.traceSignature ? { traceSignature: input.traceSignature } : {}),
    ...(input.toolStarts ? { toolStarts: input.toolStarts } : {}),
    ...(input.toolArgsPreview ? { toolArgsPreview: input.toolArgsPreview } : {}),
    ...(input.textPreview ? { textPreview: input.textPreview } : {}),
  };
}

export function createPassedEvalResult(input: {
  id: string;
  label: string;
  runtime: LiveEvalRuntime;
  details: string;
  startedAt: number;
  conversationId?: string;
  runId?: string;
  artifactPaths?: string[];
  traceSignature?: string;
  toolStarts?: string[];
  toolArgsPreview?: string;
  textPreview?: string;
}): LiveEvalResultRecord {
  return {
    id: input.id,
    label: input.label,
    runtime: input.runtime,
    status: "pass",
    details: input.details,
    durationMs: Date.now() - input.startedAt,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.artifactPaths?.length ? { artifactPaths: input.artifactPaths } : {}),
    ...(input.traceSignature ? { traceSignature: input.traceSignature } : {}),
    ...(input.toolStarts ? { toolStarts: input.toolStarts } : {}),
    ...(input.toolArgsPreview ? { toolArgsPreview: input.toolArgsPreview } : {}),
    ...(input.textPreview ? { textPreview: input.textPreview } : {}),
  };
}
