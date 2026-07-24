import { serverLogger } from "#veryfront/utils";
import type {
  StreamDiagnosticEvent,
  StreamDiagnosticPolicy,
  StreamDiagnosticSink,
  StreamRawDiagnosticCandidate,
  StreamSafeDiagnosticEvent,
} from "./types.ts";

const diagnosticLogger = serverLogger.component("stream-lifecycle");

export function createDefaultDiagnosticPolicy(): StreamDiagnosticPolicy {
  return { rawCapture: "disabled", redact: () => null };
}

export function acceptDiagnosticCandidate(
  policy: StreamDiagnosticPolicy,
  candidate: StreamRawDiagnosticCandidate,
): StreamSafeDiagnosticEvent | null {
  if (policy.rawCapture !== "redacted") return null;
  return policy.redact(candidate);
}

export function createDefaultDiagnosticSink(): StreamDiagnosticSink {
  return {
    report(event) {
      diagnosticLogger.warn("Stream lifecycle diagnostic", {
        diagnosticType: event.type,
        ...(event.type === "provider_cleanup_failed" && event.diagnosticId
          ? { diagnosticId: event.diagnosticId }
          : {}),
      });
    },
  };
}

export function reportLifecycleDiagnostic(
  sink: StreamDiagnosticSink,
  event: StreamDiagnosticEvent,
): void {
  try {
    sink.report(event);
  } catch {
    // Diagnostic reporting is fail-open and cannot alter stream control flow.
  }
}
