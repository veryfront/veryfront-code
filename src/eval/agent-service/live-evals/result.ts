import type { LiveEvalRuntime } from "./performance.ts";
import { formatEvalPublicError } from "../../validation.ts";

/** Record shape for live eval result. */
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

type EvalResultStatus = LiveEvalResultRecord["status"];
const MAX_LIVE_EVAL_RESULT_ITEMS = 1_000;

interface BaseEvalResultInput {
  id: string;
  label: string;
  runtime: LiveEvalRuntime;
  details: string;
  startedAt: number;
}

interface EvalResultInputWithContext extends BaseEvalResultInput {
  conversationId?: string;
  runId?: string;
  artifactPaths?: string[];
  traceSignature?: string;
  toolStarts?: string[];
  toolArgsPreview?: string;
  textPreview?: string;
}

function createEvalResult(
  status: EvalResultStatus,
  input: EvalResultInputWithContext,
): LiveEvalResultRecord {
  if (!Number.isFinite(input.startedAt)) {
    throw new TypeError("Live eval startedAt must be a finite number");
  }
  return {
    id: input.id,
    label: input.label,
    runtime: input.runtime,
    status,
    details: formatEvalPublicError(input.details),
    durationMs: Math.max(0, Date.now() - input.startedAt),
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.artifactPaths?.length
      ? {
        artifactPaths: input.artifactPaths.slice(0, MAX_LIVE_EVAL_RESULT_ITEMS).map((path) =>
          formatEvalPublicError(path)
        ),
      }
      : {}),
    ...(input.traceSignature
      ? { traceSignature: formatEvalPublicError(input.traceSignature) }
      : {}),
    ...(input.toolStarts
      ? {
        toolStarts: input.toolStarts.slice(0, MAX_LIVE_EVAL_RESULT_ITEMS).map((name) =>
          formatEvalPublicError(name)
        ),
      }
      : {}),
    ...(input.toolArgsPreview
      ? { toolArgsPreview: formatEvalPublicError(input.toolArgsPreview) }
      : {}),
    ...(input.textPreview ? { textPreview: formatEvalPublicError(input.textPreview) } : {}),
  };
}

/** Result returned from create skipped eval. */
export function createSkippedEvalResult(input: {
  id: string;
  label: string;
  runtime: LiveEvalRuntime;
  details: string;
  startedAt: number;
}): LiveEvalResultRecord {
  if (!Number.isFinite(input.startedAt)) {
    throw new TypeError("Live eval startedAt must be a finite number");
  }
  return {
    id: input.id,
    label: input.label,
    runtime: input.runtime,
    status: "skip",
    details: formatEvalPublicError(input.details),
    durationMs: Math.max(0, Date.now() - input.startedAt),
  };
}

/** Result returned from create failed eval. */
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
  return createEvalResult("fail", input);
}

/** Result returned from create passed eval. */
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
  return createEvalResult("pass", input);
}
