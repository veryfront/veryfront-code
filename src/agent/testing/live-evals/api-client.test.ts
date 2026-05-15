import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  cancelLiveEvalInputRequest,
  createLiveEvalApiClient,
  createLiveEvalConversation,
  createLiveEvalProjectUploadFixture,
  createLiveEvalRelease,
  deleteLiveEvalConversation,
  deleteLiveEvalProjectFile,
  getLiveEvalProjectFile,
  listOpenLiveEvalInputRequests,
  type LiveEvalApiContext,
  submitLiveEvalInputResponse,
  waitForOpenLiveEvalInputRequest,
} from "./api-client.ts";

interface RecordedRequest {
  url: string;
  path: string;
  method: string;
  body: unknown;
  authorization: string | null;
  contentType: string | null;
}

function getInputUrl(input: string | URL | Request): URL {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  if (input instanceof URL) {
    return input;
  }
  return new URL(input);
}

async function readBody(init: RequestInit | undefined): Promise<unknown> {
  const body = init?.body;
  if (typeof body === "string") {
    return JSON.parse(body);
  }
  if (body instanceof Blob) {
    return await body.text();
  }
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(body);
  }
  return null;
}

function createRecordingFetch(
  requests: RecordedRequest[],
  handler: (request: RecordedRequest) => Response,
): LiveEvalApiContext["fetch"] {
  return async (input, init) => {
    const url = getInputUrl(input);
    const headers = new Headers(init?.headers);
    const request: RecordedRequest = {
      url: url.href,
      path: `${url.pathname}${url.search}`,
      method: init?.method ?? "GET",
      body: await readBody(init),
      authorization: headers.get("Authorization"),
      contentType: headers.get("Content-Type"),
    };
    requests.push(request);
    return handler(request);
  };
}

function createContext(
  fetch: LiveEvalApiContext["fetch"],
  projectId: string | null = "project-1",
): LiveEvalApiContext {
  return {
    apiUrl: "https://api.example.test/root",
    authToken: "token-a",
    projectId,
    fetch,
  };
}

describe("agent testing live eval API client", () => {
  it("creates and deletes conversations through the control-plane API", async () => {
    const requests: RecordedRequest[] = [];
    const context = createContext(
      createRecordingFetch(requests, (request) => {
        if (request.path === "/root/conversations" && request.method === "POST") {
          return Response.json({ id: "conversation-1" });
        }
        return Response.json({ ok: true });
      }),
    );

    const id = await createLiveEvalConversation(context, {
      title: "Case A",
      requestTimeoutMs: 1_000,
    });
    await deleteLiveEvalConversation(context, {
      conversationId: id,
      requestTimeoutMs: 1_000,
    });

    assertEquals(id, "conversation-1");
    assertEquals(requests, [
      {
        url: "https://api.example.test/root/conversations",
        path: "/root/conversations",
        method: "POST",
        body: { project_id: "project-1", title: "Case A" },
        authorization: "Bearer token-a",
        contentType: "application/json",
      },
      {
        url: "https://api.example.test/root/conversations/conversation-1",
        path: "/root/conversations/conversation-1",
        method: "DELETE",
        body: null,
        authorization: "Bearer token-a",
        contentType: null,
      },
    ]);
  });

  it("fails when conversation creation does not return an id", async () => {
    const context = createContext(
      createRecordingFetch([], () => Response.json({ ok: true })),
    );

    await assertRejects(
      () => createLiveEvalConversation(context, { title: "Case A", requestTimeoutMs: 1_000 }),
      Error,
      "Conversation creation response did not include id",
    );
  });

  it("creates project upload fixtures and confirms they appear", async () => {
    const requests: RecordedRequest[] = [];
    const context = createContext(
      createRecordingFetch(requests, (request) => {
        if (request.path === "/root/projects/project-1/uploads" && request.method === "POST") {
          return Response.json({
            file_upload_url: "https://uploads.example.test/fixture",
            required_headers: { "x-upload-token": "abc" },
          });
        }
        if (request.url === "https://uploads.example.test/fixture") {
          return Response.json({ ok: true });
        }
        return Response.json({ data: [{ path: "docs/a.txt" }] });
      }),
    );

    const path = await createLiveEvalProjectUploadFixture(context, {
      filePath: "docs/a.txt",
      contentType: "text/plain",
      body: new TextEncoder().encode("hello"),
      requestTimeoutMs: 1_000,
      maxAttempts: 1,
      pollIntervalMs: 0,
    });

    assertEquals(path, "docs/a.txt");
    assertEquals(requests.map((request) => request.path), [
      "/root/projects/project-1/uploads",
      "/fixture",
      "/root/projects/project-1/uploads",
    ]);
    assertEquals(requests[0]?.body, {
      file_path: "docs/a.txt",
      content_type: "text/plain",
      size: 5,
    });
    assertEquals(requests[1]?.method, "PUT");
    assertEquals(requests[1]?.body, "hello");
    assertEquals(requests[1]?.contentType, "text/plain");
  });

  it("reads, deletes, and releases project files", async () => {
    const requests: RecordedRequest[] = [];
    const context = createContext(
      createRecordingFetch(requests, (request) => {
        if (
          request.path === "/root/projects/project-1/files/docs%2Fa.txt" && request.method === "GET"
        ) {
          return Response.json({ content: "hello" });
        }
        if (request.path === "/root/projects/project-1/releases") {
          return Response.json({ id: "release-1" });
        }
        return Response.json({ ok: true });
      }),
    );

    const file = await getLiveEvalProjectFile(context, {
      filePath: "docs/a.txt",
      requestTimeoutMs: 1_000,
    });
    const releaseId = await createLiveEvalRelease(context, { requestTimeoutMs: 1_000 });
    await deleteLiveEvalProjectFile(context, {
      filePath: "docs/a.txt",
      requestTimeoutMs: 1_000,
    });

    assertEquals(file, { path: "docs/a.txt", content: "hello" });
    assertEquals(releaseId, "release-1");
    assertEquals(requests.map((request) => `${request.method} ${request.path}`), [
      "GET /root/projects/project-1/files/docs%2Fa.txt",
      "POST /root/projects/project-1/releases",
      "DELETE /root/projects/project-1/files/docs%2Fa.txt",
    ]);
    assertEquals(requests[1]?.body, { description: "eval platform capability release" });
  });

  it("returns null when a project file is not found", async () => {
    const context = createContext(
      createRecordingFetch([], () => new Response("not found", { status: 404 })),
    );

    assertEquals(
      await getLiveEvalProjectFile(context, { filePath: "missing.txt", requestTimeoutMs: 1_000 }),
      null,
    );
  });

  it("lists, waits, submits, and cancels input requests", async () => {
    const requests: RecordedRequest[] = [];
    let listCount = 0;
    const context = createContext(
      createRecordingFetch(requests, (request) => {
        if (request.path === "/root/conversations/conversation-1/input-requests?status=open") {
          listCount += 1;
          if (listCount === 1) {
            return Response.json({ data: [{ bad: true }] });
          }
          return Response.json({ data: [{ id: "input-1", status: "open" }, { bad: true }] });
        }
        return Response.json({ ok: true });
      }),
    );

    assertEquals(
      await listOpenLiveEvalInputRequests(context, {
        conversationId: "conversation-1",
        requestTimeoutMs: 1_000,
      }),
      [],
    );
    const inputRequestId = await waitForOpenLiveEvalInputRequest(context, {
      conversationId: "conversation-1",
      abortSignal: new AbortController().signal,
      requestTimeoutMs: 1_000,
      timeoutMs: 100,
      pollIntervalMs: 0,
    });
    await submitLiveEvalInputResponse(context, {
      conversationId: "conversation-1",
      inputRequestId,
      values: { accepted: true, count: 1, note: "ok", empty: null },
      requestTimeoutMs: 1_000,
    });
    await cancelLiveEvalInputRequest(context, {
      conversationId: "conversation-1",
      inputRequestId,
      requestTimeoutMs: 1_000,
    });

    assertEquals(inputRequestId, "input-1");
    assertEquals(requests.map((request) => `${request.method} ${request.path}`), [
      "GET /root/conversations/conversation-1/input-requests?status=open",
      "GET /root/conversations/conversation-1/input-requests?status=open",
      "POST /root/conversations/conversation-1/input-requests/input-1/responses",
      "POST /root/conversations/conversation-1/input-requests/input-1/cancel",
    ]);
    assertEquals(requests[2]?.body, {
      values: { accepted: true, count: 1, note: "ok", empty: null },
    });
  });

  it("creates an object client over the standalone helpers", async () => {
    const requests: RecordedRequest[] = [];
    const context = createContext(
      createRecordingFetch(requests, () => Response.json({ id: "conversation-1" })),
      null,
    );
    const client = createLiveEvalApiClient(context);

    assertEquals(
      await client.createConversation({ title: "No Project", requestTimeoutMs: 1_000 }),
      "conversation-1",
    );
    assertEquals(requests[0]?.body, { title: "No Project" });
  });
});
