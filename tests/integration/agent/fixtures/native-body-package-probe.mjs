// Run with Node from an installed veryfront package directory:
// node --input-type=module < native-body-package-probe.mjs
// Only synthetic data is used. Install the transport stub before importing the package.
import assert from "node:assert/strict";
let fetches = 0;
globalThis.fetch = async () => {
  fetches++;
  throw new Error("Network prohibited in native body probe");
};
const { createDetachedRunTracker, createHostedAgentServiceRouteSet } = await import(
  "veryfront/agent"
);
const canary = "synthetic-package-body-canary";
const runtimeSource = { type: "release", releaseId: "release-42" };
const apply = Reflect.apply;
const decode = TextDecoder.prototype.decode;
const decoder = new TextDecoder();
const includes = String.prototype.includes;
const getReader = ReadableStream.prototype.getReader;
const read = ReadableStreamDefaultReader.prototype.read;
const promiseThen = Promise.prototype.then;

function createRequest() {
  return new Request("https://agent.example.test/api/control-plane/runs/run-1/stream", {
    method: "POST",
    headers: {
      authorization: "Bearer authenticated-user-token",
      "content-type": "application/json",
      "X-Veryfront-Run-Event-Token": "verified-event-token",
    },
    body: JSON.stringify({
      run: {
        agentServiceId: "test-agent-service",
        agentId: "builder",
        conversationId: "00000000-0000-4000-8000-000000000001",
        runId: "run-1",
        messageId: "00000000-0000-4000-8000-000000000002",
        inputAnchorMessageId: "00000000-0000-4000-8000-000000000003",
        requestedByUserId: "00000000-0000-4000-8000-000000000004",
        project: { projectId: "00000000-0000-4000-8000-000000000005", projectSlug: "demo" },
      },
      messages: [],
      tools: [],
      context: [],
      agentSource: runtimeSource,
      credentials: { authToken: "control-plane-auth-token", inferenceAuthToken: canary },
    }),
  });
}

function contains(value, depth = 0) {
  if (typeof value === "string") return apply(includes, value, [canary]);
  if (value instanceof Uint8Array) {
    return apply(includes, apply(decode, decoder, [value]), [canary]);
  }
  if (depth > 6 || typeof value !== "object" || value === null) return false;
  return Object.values(value).some((entry) => contains(entry, depth + 1));
}

async function readAll(stream) {
  const reader = apply(getReader, stream, []);
  const chunks = [];
  while (true) {
    const step = await apply(read, reader, []);
    if (step.done) return chunks;
    chunks[chunks.length] = step.value;
  }
}

function createRoutes(onAuthenticate, onDispatch) {
  return createHostedAgentServiceRouteSet({
    runtimeSource,
    tracker: createDetachedRunTracker(),
    authenticateRequest: async () => {
      onAuthenticate();
      return { authToken: "authenticated-user-token", userId: "user-1" };
    },
    verifyProjectAccess: async () => ({ success: true }),
    verifyRunEventAppendToken: async () => true,
    prepareExecution: async () => ({ executionId: "exec-1" }),
    streamExecutionToAgUiResponse: () => new Response("streamed"),
    startDetachedExecution: async ({ rawRequest }) => onDispatch(rawRequest),
  });
}

let observations = 0;
let rejected = 0;
const pending = [];

// A replaced tee observes the body when the invocation request is cloned.
const teeDescriptor = Object.getOwnPropertyDescriptor(ReadableStream.prototype, "tee");
let dispatches = 0;
Object.defineProperty(ReadableStream.prototype, "tee", {
  ...teeDescriptor,
  value: function () {
    const branches = apply(teeDescriptor.value, this, []);
    const observed = apply(teeDescriptor.value, branches[0], []);
    pending[pending.length] = apply(promiseThen, readAll(observed[0]), [(chunks) => {
      if (chunks.some((chunk) => contains(chunk))) observations++;
    }]);
    return [observed[1], branches[1]];
  },
});
try {
  await createRoutes(() => {}, () => dispatches++).handleRuntimeAgentRunInvocationExecuteRequest({
    request: createRequest(),
    runId: "run-1",
  });
} catch (error) {
  assert(error instanceof TypeError);
  rejected++;
} finally {
  Object.defineProperty(ReadableStream.prototype, "tee", teeDescriptor);
}
await Promise.allSettled(pending);
assert.equal(observations, 0, "body credential reached a modified stream tee");
assert.equal(dispatches, 0);

// An inherited then observes stream read results and parsed payloads.
let thenActive = false;
try {
  await createRoutes(() => {
    Object.defineProperty(Object.prototype, "then", { // NOSONAR S7739: synthetic promise-resolution probe.
      configurable: true,
      get() {
        if (!thenActive) {
          thenActive = true;
          try {
            if (contains(this)) observations++;
          } finally {
            thenActive = false;
          }
        }
        return undefined;
      },
    });
  }, () => dispatches++).handleRuntimeAgentRunInvocationExecuteRequest({
    request: createRequest(),
    runId: "run-1",
  });
} catch (error) {
  assert(error instanceof TypeError);
  rejected++;
} finally {
  Reflect.deleteProperty(Object.prototype, "then");
}
assert.equal(observations, 0, "body credential reached an inherited then");
assert.equal(dispatches, 0);
assert.equal(rejected, 2);

// A clean invocation dispatches an application request without the credential.
let applicationRequest;
const response = await createRoutes(() => {}, (request) => {
  applicationRequest = request;
  dispatches++;
}).handleRuntimeAgentRunInvocationExecuteRequest({ request: createRequest(), runId: "run-1" });
assert.equal(response.status, 202);
assert.equal(dispatches, 1);
assert.equal(applicationRequest.method, "POST");
assert.equal(applicationRequest.headers.get("content-type"), "application/json");
const payload = await applicationRequest.json();
assert.deepEqual(payload.credentials, { authToken: "control-plane-auth-token" });
assert.equal(fetches, 0);
console.log(JSON.stringify({
  node: process.versions.node,
  undici: process.versions.undici,
  observations,
  fetches,
  rejected,
  cleanRequests: dispatches,
}));
