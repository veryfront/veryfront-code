/**
 * Sends one conversations operation through the canonical Veryfront API transport and maps
 * an error response to an SDK error that carries the problem body.
 */
import { API_CLIENT_ERROR } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import {
  readVeryfrontApiResponse,
  type VeryfrontApiTransport,
} from "#veryfront/platform/adapters/veryfront-api-transport.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { CONVERSATIONS_OPERATIONS, type ConversationsOperationId } from "./operations.ts";
import type { ConversationClientOptions, ConversationsProblem } from "./types.ts";

type QueryValue = string | number | undefined;

/** Wire request of one operation, in the REST spelling. */
export interface ConversationsWireInput {
  path?: Record<string, string>;
  query?: Record<string, QueryValue>;
  body?: unknown;
}

const PATH_PARAMETER = /\{(\w+)\}/g;

/** Most bytes read from an error response body. */
const MAX_PROBLEM_BODY_BYTES = 8 * 1024;

function buildPath(operationId: ConversationsOperationId, input: ConversationsWireInput): string {
  const path = CONVERSATIONS_OPERATIONS[operationId].path.replace(
    PATH_PARAMETER,
    (_match: string, name: string) => {
      const value = input.path?.[name];
      // URL resolution collapses "." and "..", which would address the parent resource.
      if (typeof value !== "string" || value.length === 0 || value === "." || value === "..") {
        throw new TypeError(`${operationId} requires the path parameter ${name}`);
      }
      return encodeURIComponent(value);
    },
  );
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined) query.append(name, String(value));
  }
  return query.size ? `${path}?${query}` : path;
}

function isProblem(value: unknown): value is ConversationsProblem {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.type === "string" && typeof candidate.title === "string" &&
    typeof candidate.status === "number";
}

function readProblem(response: Response, text: string): ConversationsProblem {
  try {
    const parsed = JSON.parse(text);
    if (isProblem(parsed)) return parsed;
  } catch {
    // Not JSON: fall through to a problem built from the status line.
  }
  return {
    type: "about:blank",
    title: response.statusText || `HTTP ${response.status}`,
    status: response.status,
  };
}

function problemError(
  operationId: ConversationsOperationId,
  response: Response,
  text: string,
): VeryfrontError {
  const problem = readProblem(response, text);
  // The message holds only the operation and status: a problem body can echo caller data,
  // so it stays in the context for conversationsProblemOf.
  return API_CLIENT_ERROR.create({
    detail: `${operationId} failed with status ${response.status}`,
    status: response.status,
    instance: problem.instance,
    context: { operationId, problem },
  });
}

/** Send one operation and resolve with its parsed JSON body, or `undefined` for 204. */
export function sendConversationsOperation(
  transport: VeryfrontApiTransport<unknown>,
  operationId: ConversationsOperationId,
  input: ConversationsWireInput,
  signal?: AbortSignal,
): Promise<unknown> {
  const headers = new Headers({ Accept: "application/json" });
  if (input.body !== undefined) headers.set("Content-Type", "application/json");
  return transport.request(buildPath(operationId, input), {
    method: CONVERSATIONS_OPERATIONS[operationId].method,
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    signal,
    onResponse: async (response, responseInit, url, responseSignal) => {
      if (response.ok) {
        return await readVeryfrontApiResponse(response, responseInit, url, responseSignal);
      }
      // Read the error body here: the shared reader would log it.
      const { text } = await readResponseTextPrefix(
        response,
        MAX_PROBLEM_BODY_BYTES,
        responseSignal,
      );
      throw problemError(operationId, response, text);
    },
  });
}

/** Require the transport of a conversations SDK call. */
export function requireConversationsTransport(
  options: ConversationClientOptions,
): VeryfrontApiTransport<unknown> {
  const transport = options?.transport;
  if (!transport || typeof transport.request !== "function") {
    throw new TypeError(
      "The conversations SDK requires a transport. Create one with createConversationsApiTransport.",
    );
  }
  return transport;
}

/** The problem body of an error thrown by the conversations SDK, or `undefined` for any other error. */
export function conversationsProblemOf(error: unknown): ConversationsProblem | undefined {
  if (!(error instanceof VeryfrontError)) return undefined;
  const context = error.context as { problem?: ConversationsProblem } | undefined;
  return context?.problem;
}

/** Reject a success body that is not a JSON object. */
export function requireResponseObject(
  operationId: ConversationsOperationId,
  value: unknown,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw API_CLIENT_ERROR.create({
      detail: `${operationId} returned a response that is not a JSON object`,
      status: 502,
      context: { operationId },
    });
  }
  return value as Record<string, unknown>;
}
