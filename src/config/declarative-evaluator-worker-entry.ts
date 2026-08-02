/**
 * One-shot worker entry for hosted declarative configuration evaluation.
 *
 * The parser is part of the worker's initial module graph, so a Deno worker
 * created with `permissions: "none"` never needs a late dynamic parser import.
 * Only validated protocol DTOs cross this boundary; evaluation errors are
 * serialized without their messages, stacks, or source text.
 *
 * @module
 */

import { BabelParseOnlyParser } from "@veryfront/ext-parser-babel/parser-only";
import { evaluateDeclarativeConfigWithParser } from "./declarative-evaluator.ts";
import {
  createDeclarativeConfigWorkerErrorResponse,
  createDeclarativeConfigWorkerSuccessResponse,
  decodeDeclarativeConfigWorkerRequest,
} from "./declarative-evaluator-worker-protocol.ts";

interface WorkerEntryTransport {
  postMessage(value: unknown): void;
  close(): void;
}

interface WebWorkerScope {
  addEventListener(
    type: "message" | "messageerror",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  removeEventListener(
    type: "message" | "messageerror",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(value: unknown): void;
  close(): void;
}

async function evaluateRequest(value: unknown): Promise<unknown> {
  try {
    const request = decodeDeclarativeConfigWorkerRequest(value);
    const snapshot = await evaluateDeclarativeConfigWithParser(
      request.evaluationOptions,
      new BabelParseOnlyParser(),
    );
    return createDeclarativeConfigWorkerSuccessResponse(snapshot);
  } catch (error) {
    return createDeclarativeConfigWorkerErrorResponse(error);
  }
}

function closeSafely(transport: WorkerEntryTransport): void {
  try {
    transport.close();
  } catch {
    // The result has already been sent, so there is no second safe response.
  }
}

function processRequest(value: unknown, transport: WorkerEntryTransport): void {
  void evaluateRequest(value).then(
    (response) => {
      try {
        transport.postMessage(response);
      } catch {
        // A broken transport cannot accept a second response attempt.
      } finally {
        closeSafely(transport);
      }
    },
    (error) => {
      // The protocol serializer is expected to be total, but retain the same
      // redacted boundary if an unexpected promise rejection escapes.
      try {
        transport.postMessage(
          createDeclarativeConfigWorkerErrorResponse(error),
        );
      } catch {
        // A broken transport cannot accept a second response attempt.
      } finally {
        closeSafely(transport);
      }
    },
  ).catch(() => closeSafely(transport));
}

function isWebWorkerScope(value: unknown): value is WebWorkerScope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<WebWorkerScope>;
  return typeof candidate.addEventListener === "function" &&
    typeof candidate.removeEventListener === "function" &&
    typeof candidate.postMessage === "function" &&
    typeof candidate.close === "function";
}

function installWebWorkerTransport(scope: WebWorkerScope): void {
  let claimed = false;

  const removeListeners = (): void => {
    scope.removeEventListener("message", onMessage);
    scope.removeEventListener("messageerror", onMessageError);
  };
  const claim = (): boolean => {
    if (claimed) return false;
    claimed = true;
    removeListeners();
    return true;
  };
  const transport: WorkerEntryTransport = {
    postMessage(value) {
      scope.postMessage(value);
    },
    close() {
      scope.close();
    },
  };
  const onMessage = (event: MessageEvent<unknown>): void => {
    if (!claim()) return;
    processRequest(event.data, transport);
  };
  const onMessageError = (_event: MessageEvent<unknown>): void => {
    if (!claim()) return;
    processRequest(undefined, transport);
  };

  scope.addEventListener("message", onMessage);
  scope.addEventListener("messageerror", onMessageError);
}

async function installNodeWorkerTransport(): Promise<void> {
  const { parentPort } = await import("node:worker_threads");
  if (parentPort === null) {
    throw new TypeError(
      "Declarative evaluator worker entry requires a worker transport",
    );
  }

  let claimed = false;
  const removeListeners = (): void => {
    parentPort.off("message", onMessage);
    parentPort.off("messageerror", onMessageError);
  };
  const claim = (): boolean => {
    if (claimed) return false;
    claimed = true;
    removeListeners();
    return true;
  };
  const transport: WorkerEntryTransport = {
    postMessage(value) {
      parentPort.postMessage(value);
    },
    close() {
      parentPort.close();
    },
  };
  const onMessage = (value: unknown): void => {
    if (!claim()) return;
    processRequest(value, transport);
  };
  const onMessageError = (_error: unknown): void => {
    if (!claim()) return;
    processRequest(undefined, transport);
  };

  parentPort.once("message", onMessage);
  parentPort.once("messageerror", onMessageError);
}

if (isWebWorkerScope(globalThis)) {
  installWebWorkerTransport(globalThis);
} else {
  await installNodeWorkerTransport();
}
