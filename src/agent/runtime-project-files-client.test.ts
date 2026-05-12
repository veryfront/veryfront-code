import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import {
  getRuntimeProjectFile,
  getRuntimeProjectFiles,
  RuntimeProjectFilesApiAuthError,
  type RuntimeProjectFilesFetch,
} from "./runtime-project-files-client.ts";

const baseOptions = {
  apiUrl: "https://api.test",
  projectId: "project-1",
  authToken: "token-1",
};

type FetchCall = {
  url: string;
  init: RequestInit;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

function mockFetchResponses(
  ...responses: Response[]
): RuntimeProjectFilesFetch & { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchMock = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const response = responses.shift();
    if (!response) {
      throw new Error("Unexpected fetch call");
    }
    return response;
  };

  return Object.assign(fetchMock, { calls });
}

function getRequestedUrl(fetchSpy: ReturnType<typeof mockFetchResponses>, index = 0): URL {
  return new URL(getFetchCall(fetchSpy, index).url);
}

function getFetchCall(fetchSpy: ReturnType<typeof mockFetchResponses>, index = 0): FetchCall {
  const call = fetchSpy.calls[index];
  if (!call) {
    throw new Error(`Expected fetch call ${index}`);
  }
  return call;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  throw new Error("Expected Error");
}

Deno.test("getRuntimeProjectFile returns a project file from the API file route", async () => {
  const fileData = { path: "src/index.ts", content: "hello" };
  const fetchSpy = mockFetchResponses(
    jsonResponse({ ...fileData, type: "file", size: 5, checksum: null }),
  );

  const result = await getRuntimeProjectFile({
    ...baseOptions,
    fetch: fetchSpy,
    path: "src/index.ts",
  });

  assertEquals(result, fileData);
});

Deno.test("getRuntimeProjectFile returns null when the API file route returns 404", async () => {
  const fetchSpy = mockFetchResponses(textResponse("File not found", 404));

  const result = await getRuntimeProjectFile({
    ...baseOptions,
    fetch: fetchSpy,
    path: "missing.ts",
  });

  assertEquals(result, null);
});

Deno.test("getRuntimeProjectFile throws auth errors for API HTTP 401 and 403", async () => {
  const unauthorizedFetch = mockFetchResponses(textResponse("Unauthorized", 401));
  const unauthorizedError = await assertRejects(() =>
    getRuntimeProjectFile({ ...baseOptions, fetch: unauthorizedFetch, path: "src/index.ts" })
  );
  assertInstanceOf(unauthorizedError, RuntimeProjectFilesApiAuthError);

  const forbiddenFetch = mockFetchResponses(textResponse("Forbidden", 403));
  const forbiddenError = await assertRejects(() =>
    getRuntimeProjectFile({ ...baseOptions, fetch: forbiddenFetch, path: "src/index.ts" })
  );
  assertInstanceOf(forbiddenError, RuntimeProjectFilesApiAuthError);
});

Deno.test("getRuntimeProjectFile supports a custom access-denied error factory", async () => {
  const fetchSpy = mockFetchResponses(textResponse("Forbidden", 403));

  const error = await assertRejects(() =>
    getRuntimeProjectFile({
      ...baseOptions,
      fetch: fetchSpy,
      path: "src/index.ts",
      createAccessDeniedError: (statusCode, message) => new Error(`${statusCode}: ${message}`),
    })
  );

  assertEquals(getErrorMessage(error), "403: Access denied to project files API");
});

Deno.test("getRuntimeProjectFile reports upstream and network errors", async () => {
  const upstreamFetch = mockFetchResponses(textResponse("Internal Server Error", 500));
  const upstreamError = await assertRejects(() =>
    getRuntimeProjectFile({ ...baseOptions, fetch: upstreamFetch, path: "src/index.ts" })
  );
  assertStringIncludes(
    getErrorMessage(upstreamError),
    "Failed to fetch file src/index.ts for project project-1: Internal Server Error",
  );

  const networkFetch: RuntimeProjectFilesFetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  const networkError = await assertRejects(() =>
    getRuntimeProjectFile({ ...baseOptions, fetch: networkFetch, path: "src/index.ts" })
  );
  assertStringIncludes(getErrorMessage(networkError), "ECONNREFUSED");
});

Deno.test("getRuntimeProjectFile passes project, path, branch, fields, and auth through REST", async () => {
  const fetchSpy = mockFetchResponses(jsonResponse({ path: "src/index.ts", content: "hello" }));

  await getRuntimeProjectFile({
    ...baseOptions,
    fetch: fetchSpy,
    path: "src/index.ts",
    branchId: "branch-1",
  });

  const url = getRequestedUrl(fetchSpy);
  assertEquals(url.origin, "https://api.test");
  assertEquals(url.pathname, "/projects/project-1/files/src%2Findex.ts");
  assertEquals(url.searchParams.get("branch"), "branch-1");
  assertEquals(url.searchParams.get("fields"), "(path,content)");
  assertEquals(
    new Headers(getFetchCall(fetchSpy).init.headers).get("Authorization"),
    "Bearer token-1",
  );
});

Deno.test("getRuntimeProjectFiles returns project file paths from the API list route", async () => {
  const files = [{ path: "src/index.ts" }];
  const fetchSpy = mockFetchResponses(
    jsonResponse({
      data: [{
        ...files[0],
        type: "file",
        size: 1,
        content: "ignored",
        updated_at: "2026-01-01T00:00:00Z",
      }],
      page_info: { next: null },
    }),
  );

  const result = await getRuntimeProjectFiles({ ...baseOptions, fetch: fetchSpy });

  assertEquals(result, files);
});

Deno.test("getRuntimeProjectFiles follows API pagination until no next cursor remains", async () => {
  const fetchSpy = mockFetchResponses(
    jsonResponse({
      data: [{ path: "a.ts" }],
      page_info: { next: "cursor-2" },
    }),
    jsonResponse({
      data: [{ path: "b.ts" }],
      page_info: { next: null },
    }),
  );

  const result = await getRuntimeProjectFiles({ ...baseOptions, fetch: fetchSpy });

  assertEquals(result, [{ path: "a.ts" }, { path: "b.ts" }]);
  assertEquals(getRequestedUrl(fetchSpy, 1).searchParams.get("cursor"), "cursor-2");
});

Deno.test("getRuntimeProjectFiles throws auth errors for API HTTP 401 and 403", async () => {
  const unauthorizedFetch = mockFetchResponses(textResponse("Unauthorized", 401));
  const unauthorizedError = await assertRejects(() =>
    getRuntimeProjectFiles({ ...baseOptions, fetch: unauthorizedFetch })
  );
  assertInstanceOf(unauthorizedError, RuntimeProjectFilesApiAuthError);

  const forbiddenFetch = mockFetchResponses(textResponse("Forbidden", 403));
  const forbiddenError = await assertRejects(() =>
    getRuntimeProjectFiles({ ...baseOptions, fetch: forbiddenFetch })
  );
  assertInstanceOf(forbiddenError, RuntimeProjectFilesApiAuthError);
});

Deno.test("getRuntimeProjectFiles reports upstream and network errors", async () => {
  const notFoundFetch = mockFetchResponses(textResponse("Project not found", 404));
  const notFoundError = await assertRejects(() =>
    getRuntimeProjectFiles({ ...baseOptions, fetch: notFoundFetch })
  );
  assertStringIncludes(getErrorMessage(notFoundError), "Project not found");

  const upstreamFetch = mockFetchResponses(textResponse("Internal Server Error", 500));
  const upstreamError = await assertRejects(() =>
    getRuntimeProjectFiles({ ...baseOptions, fetch: upstreamFetch })
  );
  assertStringIncludes(getErrorMessage(upstreamError), "Internal Server Error");

  const networkFetch: RuntimeProjectFilesFetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  const networkError = await assertRejects(() =>
    getRuntimeProjectFiles({ ...baseOptions, fetch: networkFetch })
  );
  assertStringIncludes(getErrorMessage(networkError), "ECONNREFUSED");
});

Deno.test("getRuntimeProjectFiles passes project, branch, fields, pagination limit, and auth through REST", async () => {
  const fetchSpy = mockFetchResponses(jsonResponse({ data: [], page_info: { next: null } }));

  await getRuntimeProjectFiles({ ...baseOptions, fetch: fetchSpy, branchId: "branch-1" });

  const url = getRequestedUrl(fetchSpy);
  assertEquals(url.origin, "https://api.test");
  assertEquals(url.pathname, "/projects/project-1/files");
  assertEquals(url.searchParams.get("branch"), "branch-1");
  assertEquals(url.searchParams.get("fields"), "(path)");
  assertEquals(url.searchParams.get("limit"), "100");
  assertEquals(
    new Headers(getFetchCall(fetchSpy).init.headers).get("Authorization"),
    "Bearer token-1",
  );
});
