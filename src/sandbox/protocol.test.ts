import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertThrows } from "#veryfront/testing/assert";
import {
  parseBackgroundCommand,
  parseBackgroundCommandList,
  parseExecStreamEvent,
  parseSandboxListResponse,
  parseSandboxSessionRecord,
} from "./protocol.ts";

const validCommand = {
  id: "command-1",
  status: "running",
  exit_code: null,
  signal: null,
  started_at: "2026-01-01T00:00:00Z",
  finished_at: null,
  heartbeat_status: "healthy",
  last_heartbeat_at: null,
  last_heartbeat_error: null,
  heartbeat_failure_count: 0,
};

Deno.test("sandbox protocol validates session identity and endpoint", () => {
  assertEquals(
    parseSandboxSessionRecord(
      {
        id: "session-1",
        endpoint: "https://sandbox.example.com",
        status: "running",
      },
      "Create sandbox",
      { requireId: true },
    ),
    {
      id: "session-1",
      endpoint: "https://sandbox.example.com",
      status: "running",
    },
  );

  assertThrows(
    () =>
      parseSandboxSessionRecord(
        { id: "other", endpoint: "https://sandbox.example.com", status: "running" },
        "Get sandbox",
        { expectedId: "expected" },
      ),
    VeryfrontError,
    "does not match",
  );
  assertThrows(
    () =>
      parseSandboxSessionRecord(
        { id: "session-1", status: "running" },
        "Get sandbox",
        { requireId: true },
      ),
    VeryfrontError,
    "missing endpoint",
  );
  assertThrows(
    () =>
      parseSandboxSessionRecord(
        {
          id: "session-1",
          endpoint: "https://sandbox.example.com?credential=ambiguous",
          status: "running",
        },
        "Get sandbox",
        { requireId: true },
      ),
    VeryfrontError,
    "must not contain a query string or fragment",
  );
});

Deno.test("sandbox protocol rejects malformed list and background command envelopes", () => {
  assertThrows(
    () => parseSandboxListResponse({ data: {}, page_info: {} }, "List sandboxes"),
    VeryfrontError,
    "data must be an array",
  );
  assertThrows(
    () => parseBackgroundCommand({ ...validCommand, status: "unknown" }, "Get command"),
    VeryfrontError,
    "status is not a recognized",
  );
  assertThrows(
    () => parseBackgroundCommandList({}, "List commands"),
    VeryfrontError,
    "commands must be an array",
  );

  let accessorCalls = 0;
  const data: unknown[] = [];
  Object.defineProperty(data, "0", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return {};
    },
  });
  assertThrows(
    () => parseSandboxListResponse({ data, page_info: {} }, "List sandboxes"),
    VeryfrontError,
    "must be a data property",
  );
  assertEquals(accessorCalls, 0);
});

Deno.test("sandbox protocol accepts valid commands and rejects malformed stream events", () => {
  assertEquals(parseBackgroundCommand(validCommand, "Get command"), {
    id: "command-1",
    status: "running",
    exitCode: null,
    signal: null,
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: null,
    heartbeatStatus: "healthy",
    lastHeartbeatAt: null,
    lastHeartbeatError: null,
    heartbeatFailureCount: 0,
  });
  assertThrows(
    () => parseExecStreamEvent({ type: "stdout", data: 42 }, "Exec stream"),
    VeryfrontError,
    "data must be a string",
  );
  assertThrows(
    () => parseExecStreamEvent({ type: "mystery" }, "Exec stream"),
    VeryfrontError,
    "event type is not recognized",
  );
  assertThrows(
    () => parseExecStreamEvent({ type: "exit", exitCode: 0, data: "late" }, "Exec stream"),
    VeryfrontError,
    "data is not valid on exit events",
  );
});
