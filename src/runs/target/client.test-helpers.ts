/**
 * One request/response fixture per Runs target operation, built from the pinned contract
 * examples and typed by it: a contract change that breaks an example fails to compile.
 * The SDK tests replay them through {@link createFixtureTransport}; the integration (#2239)
 * and CLI (#2240) lanes reuse them. A fixture response is never evidence of deployed parity.
 */
import type { RunsInput, RunsOperationId, RunsOutput } from "./client.ts";
import { RUNS_OPERATION_FIXTURES } from "../contract/runs-fixtures.generated.ts";
import {
  createCanonicalVeryfrontApiTransport,
  type VeryfrontApiTransport,
} from "#veryfront/platform/adapters/veryfront-api-transport.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { RUNS_OPERATIONS } from "./operations.ts";

/** Expected wire request and canned response for one operation. */
export interface RunsOperationFixture<K extends RunsOperationId> {
  input: RunsInput<K>;
  /** Path and query exactly as the SDK must send them. */
  url: string;
  response: {
    status: number;
    body: (typeof RUNS_OPERATIONS)[K] extends { stream: true } ? string : RunsOutput<K>;
  };
}

export { RUNS_OPERATION_FIXTURES } from "../contract/runs-fixtures.generated.ts";

/** Requests the SDK sent, in order, and a transport that answers with queued responses. */
export interface FixtureTransport {
  transport: VeryfrontApiTransport<unknown>;
  requests: Request[];
}

/** A controlled transport: records every request and replays `responses` in order. */
export function createFixtureTransport(
  responses: Response[],
  getToken: () => string = () => "user-token",
  baseUrl = "https://api.example.test",
): FixtureTransport {
  const queue = [...responses];
  const requests: Request[] = [];
  const canonical = createCanonicalVeryfrontApiTransport(baseUrl, getToken, {
    maxRetries: 0,
    initialDelay: 0,
    maxDelay: 0,
  });
  const transport: VeryfrontApiTransport<unknown> = {
    request: (path, init) =>
      withMockFetch((url, requestInit) => {
        const request = new Request(url, requestInit as RequestInit);
        requests.push(request);
        const response = queue.shift();
        if (!response) return Promise.reject(new Error(`No fixture response for ${request.url}`));
        return Promise.resolve(response);
      }, () => canonical.request(path, init)),
  };
  return { transport, requests };
}

/** The canned response of one operation fixture as a `Response`. */
export function fixtureResponse<K extends RunsOperationId>(operationId: K): Response {
  const { status, body } = RUNS_OPERATION_FIXTURES[operationId].response;
  if (body === undefined) return new Response(null, { status });
  if (typeof body === "string") {
    return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
  }
  return Response.json(body, { status });
}
