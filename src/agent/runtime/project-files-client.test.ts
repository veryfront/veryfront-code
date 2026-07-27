import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { SKILL_TEXT_FILE_MAX_BYTES } from "#veryfront/skill/limits.ts";
import {
  createRuntimeProjectFilesClient,
  createStrictRuntimeProjectFilesClient,
  getRuntimeProjectFile,
  getRuntimeProjectFileListItemSchema,
  getRuntimeProjectFiles,
  getRuntimeProjectFileSchema,
  getStrictRuntimeProjectFile,
  getStrictRuntimeProjectFileListItemSchema,
  getStrictRuntimeProjectFiles,
  getStrictRuntimeProjectFileSchema,
  type RuntimeGetProjectFileOptions,
  runtimeProjectFileListItemSchema,
  RuntimeProjectFilesApiAuthError,
  runtimeProjectFileSchema,
  type RuntimeProjectFilesFetch,
} from "./project-files-client.ts";

const baseOptions = {
  apiUrl: "https://api.test",
  projectId: "project-1",
  authToken: "token-1",
};

const TEST_MAX_PAGE_LIMIT = 100;
const TEST_MAX_TOTAL_FILES = 10_000;
const TEST_MAX_TOTAL_PAGES = 200;
const TEST_MAX_PATH_CHARACTERS = 4_096;
const TEST_MAX_ERROR_BODY_BYTES = 64 * 1_024;

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

function erroringResponse(error: unknown, status = 200): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(error);
      },
    }),
    { status },
  );
}

function streamResponse(
  chunks: readonly Uint8Array[],
  init: ResponseInit = {},
  hooks: { onPull?: () => void; onCancel?: () => void } = {},
): Response {
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        hooks.onPull?.();
        const chunk = chunks[index];
        index += 1;
        if (chunk) {
          controller.enqueue(chunk);
        } else {
          controller.close();
        }
      },
      cancel() {
        hooks.onCancel?.();
      },
    }),
    init,
  );
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

Deno.test("legacy runtime project file schemas preserve permissive string paths", () => {
  const legacyPaths = [
    "",
    "../secret.md",
    "/absolute.md",
    "skills\\writer\\SKILL.md",
    "skills//writer/SKILL.md",
    "control\u0000path",
    String.fromCharCode(0xd800),
    "x".repeat(TEST_MAX_PATH_CHARACTERS + 1),
  ];

  for (const path of legacyPaths) {
    for (const schema of [getRuntimeProjectFileSchema(), runtimeProjectFileSchema]) {
      assertEquals(schema.safeParse({ path, content: "Body" }).success, true);
    }
    for (
      const schema of [
        getRuntimeProjectFileListItemSchema(),
        runtimeProjectFileListItemSchema,
      ]
    ) {
      assertEquals(schema.safeParse({ path }).success, true);
    }

    assertEquals(
      getStrictRuntimeProjectFileSchema().safeParse({ path, content: "Body" }).success,
      false,
    );
    assertEquals(
      getStrictRuntimeProjectFileListItemSchema().safeParse({ path }).success,
      false,
    );
  }

  const oversizedContent = "x".repeat(SKILL_TEXT_FILE_MAX_BYTES + 1);
  assertEquals(
    getRuntimeProjectFileSchema().safeParse({ path: "safe.md", content: oversizedContent }).success,
    true,
  );
  assertEquals(
    getStrictRuntimeProjectFileSchema().safeParse({
      path: "safe.md",
      content: oversizedContent,
    }).success,
    true,
  );
});

Deno.test("legacy runtime project files client defers configuration and preserves overrides", async () => {
  const deferredClient = createRuntimeProjectFilesClient({
    apiUrl: "not a URL",
    timeoutMs: 0,
    pageLimit: TEST_MAX_PAGE_LIMIT + 1,
  });
  assertEquals(typeof deferredClient.getProjectFile, "function");

  const initialFetch = mockFetchResponses(
    jsonResponse({ path: "src/index.ts", content: "initial" }),
  );
  const mutatedFetch = mockFetchResponses(
    jsonResponse({ path: "src/index.ts", content: "mutated" }),
  );
  const mutableOptions: {
    apiUrl: URL;
    fetch: RuntimeProjectFilesFetch;
  } = {
    apiUrl: new URL("https://initial.example.com/v1"),
    fetch: initialFetch,
  };
  const mutableClient = createRuntimeProjectFilesClient(mutableOptions);
  mutableOptions.apiUrl.hostname = "mutated.example.com";
  mutableOptions.fetch = mutatedFetch;

  const mutatedResult = await mutableClient.getProjectFile({
    projectId: "project-1",
    authToken: "token-1",
    path: "src/index.ts",
  });
  assertEquals(mutatedResult?.content, "mutated");
  assertEquals(mutatedFetch.calls.length, 1);
  assertEquals(getRequestedUrl(mutatedFetch).origin, "https://mutated.example.com");
  assertEquals(initialFetch.calls.length, 0);

  const configuredFetch = mockFetchResponses(
    jsonResponse({ path: "src/index.ts", content: "configured" }),
  );
  const overrideFetch = mockFetchResponses(
    jsonResponse({ path: "src/index.ts", content: "override" }),
  );
  const configuredClient = createRuntimeProjectFilesClient({
    apiUrl: "https://configured.example.com",
    fetch: configuredFetch,
  });
  const overrideResult = await configuredClient.getProjectFile({
    projectId: "project-1",
    authToken: "token-1",
    path: "src/index.ts",
    apiUrl: "https://override.example.com",
    fetch: overrideFetch,
  } as RuntimeGetProjectFileOptions);

  assertEquals(overrideResult?.content, "override");
  assertEquals(getRequestedUrl(overrideFetch).origin, "https://override.example.com");
  assertEquals(configuredFetch.calls.length, 0);
});

Deno.test("legacy runtime project file validation remains inside the trace callback", async () => {
  let legacyTraceCalls = 0;
  const legacyResult = await getRuntimeProjectFile({
    apiUrl: "not a URL",
    projectId: "..",
    authToken: "",
    path: "../unsafe.md",
    trace: async <T>(_name: string, _fn: () => Promise<T>): Promise<T> => {
      legacyTraceCalls += 1;
      return { path: "/trace-result.md", content: "legacy" } as T;
    },
  });
  assertEquals(legacyTraceCalls, 1);
  assertEquals(legacyResult, { path: "/trace-result.md", content: "legacy" });

  let strictTraceCalls = 0;
  await assertRejects(() =>
    getStrictRuntimeProjectFile({
      apiUrl: "not a URL",
      projectId: "..",
      authToken: "",
      path: "../unsafe.md",
      trace: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => {
        strictTraceCalls += 1;
        return await fn();
      },
    })
  );
  assertEquals(strictTraceCalls, 0);
});

Deno.test("legacy getRuntimeProjectFile returns mismatched paths and oversized content", async () => {
  const content = "x".repeat(SKILL_TEXT_FILE_MAX_BYTES + 1);
  const fetchSpy = mockFetchResponses(
    jsonResponse({ path: "/different.md", content }),
  );

  const result = await getRuntimeProjectFile({
    apiUrl: "https://api.test",
    projectId: "project/one",
    authToken: "",
    branchId: "",
    path: "../requested.md",
    fetch: fetchSpy,
  });

  assertEquals(result, { path: "/different.md", content });
  assertEquals(
    getRequestedUrl(fetchSpy).pathname,
    "/projects/project%2Fone/files/..%2Frequested.md",
  );
  assertEquals(getRequestedUrl(fetchSpy).searchParams.has("branch"), false);
});

Deno.test("legacy getRuntimeProjectFiles preserves unbounded pagination semantics", async () => {
  const firstPage = Array.from(
    { length: TEST_MAX_PAGE_LIMIT + 1 },
    (_, index) => ({ path: index === 0 ? "../unsafe.md" : `file-${index}.ts` }),
  );
  const fetchSpy = mockFetchResponses(
    jsonResponse({ data: firstPage, page_info: { next: "repeat" } }),
    jsonResponse({ data: [{ path: "/second.md" }], page_info: { next: "repeat" } }),
    jsonResponse({ data: [{ path: "" }], page_info: { next: "" } }),
  );

  const files = await getRuntimeProjectFiles({
    ...baseOptions,
    fetch: fetchSpy,
    pageLimit: 10,
  });

  assertEquals(files.length, TEST_MAX_PAGE_LIMIT + 3);
  assertEquals(files[0]?.path, "../unsafe.md");
  assertEquals(files.at(-1)?.path, "");
  assertEquals(fetchSpy.calls.length, 3);
  assertEquals(getRequestedUrl(fetchSpy, 1).searchParams.get("cursor"), "repeat");
  assertEquals(getRequestedUrl(fetchSpy, 2).searchParams.get("cursor"), "repeat");
});

Deno.test("legacy project file response and error body handling remains observable", async () => {
  const malformedFetch = mockFetchResponses(new Response("{", { status: 200 }));
  await assertRejects(
    () =>
      getRuntimeProjectFile({
        ...baseOptions,
        fetch: malformedFetch,
        path: "src/index.ts",
      }),
    SyntaxError,
  );

  const detail = `start-${"x".repeat(TEST_MAX_ERROR_BODY_BYTES)}-end`;
  const errorFetch = mockFetchResponses(jsonResponse({ detail }, 500));
  const error = await assertRejects(() =>
    getRuntimeProjectFile({
      ...baseOptions,
      fetch: errorFetch,
      path: "src/index.ts",
    })
  );
  assertStringIncludes(getErrorMessage(error), detail);
  assertEquals(getErrorMessage(error).includes("[truncated]"), false);

  let cancelled = false;
  const notFoundFetch = mockFetchResponses(
    streamResponse([new TextEncoder().encode("not found")], { status: 404 }, {
      onCancel: () => {
        cancelled = true;
      },
    }),
  );
  assertEquals(
    await getRuntimeProjectFile({
      ...baseOptions,
      fetch: notFoundFetch,
      path: "missing.ts",
    }),
    null,
  );
  await Promise.resolve();
  assertEquals(cancelled, false);
});

Deno.test("getStrictRuntimeProjectFile returns a project file from the API file route", async () => {
  const fileData = { path: "src/index.ts", content: "hello" };
  const fetchSpy = mockFetchResponses(
    jsonResponse({ ...fileData, type: "file", size: 5, checksum: null }),
  );

  const result = await getStrictRuntimeProjectFile({
    ...baseOptions,
    fetch: fetchSpy,
    path: "src/index.ts",
  });

  assertEquals(result, fileData);
});

Deno.test("getStrictRuntimeProjectFile validates well-formed UTF-16 paths before URL encoding", async () => {
  let fetchCalls = 0;
  const fetchMock: RuntimeProjectFilesFetch = async () => {
    fetchCalls += 1;
    return jsonResponse({ path: "unused", content: "unused" });
  };

  for (
    const malformedPath of [
      String.fromCharCode(0xd800),
      String.fromCharCode(0xdc00),
    ]
  ) {
    const error = await assertRejects(() =>
      getStrictRuntimeProjectFile({
        ...baseOptions,
        fetch: fetchMock,
        path: malformedPath,
      })
    );
    assertInstanceOf(error, RangeError);
    assertStringIncludes(getErrorMessage(error), "well-formed UTF-16");
  }

  assertEquals(fetchCalls, 0);

  const validPath = "skills/\u{1f600}/SKILL.md";
  const validFetch = mockFetchResponses(
    jsonResponse({ path: validPath, content: "valid" }),
  );
  const result = await getStrictRuntimeProjectFile({
    ...baseOptions,
    fetch: validFetch,
    path: validPath,
  });
  assertEquals(result?.path, validPath);
});

Deno.test("getStrictRuntimeProjectFile rejects non-canonical project paths before URL encoding", async () => {
  let fetchCalls = 0;
  const fetchMock: RuntimeProjectFilesFetch = async () => {
    fetchCalls += 1;
    return jsonResponse({ path: "unused", content: "unused" });
  };

  for (
    const path of [
      "../secret.md",
      "/absolute.md",
      "skills\\writer\\SKILL.md",
      "skills//writer/SKILL.md",
      "skills/./writer/SKILL.md",
      `skills/${"x".repeat(256)}/SKILL.md`,
    ]
  ) {
    await assertRejects(
      () =>
        getStrictRuntimeProjectFile({
          ...baseOptions,
          fetch: fetchMock,
          path,
        }),
      RangeError,
      "canonical",
    );
  }
  assertEquals(fetchCalls, 0);
});

Deno.test("getStrictRuntimeProjectFile rejects ill-formed UTF-16 response paths", async () => {
  const fetchSpy = mockFetchResponses(
    jsonResponse({ path: String.fromCharCode(0xd800), content: "invalid" }),
  );

  const error = await assertRejects(() =>
    getStrictRuntimeProjectFile({
      ...baseOptions,
      fetch: fetchSpy,
      path: "skills/requested/SKILL.md",
    })
  );

  assertStringIncludes(getErrorMessage(error), "invalid API response");
  assertEquals(getErrorMessage(error).includes("response path did not match"), false);
});

Deno.test("getStrictRuntimeProjectFile accepts content at the byte limit", async () => {
  const content = "x".repeat(SKILL_TEXT_FILE_MAX_BYTES);
  const fetchSpy = mockFetchResponses(
    jsonResponse({ path: "skills/large/SKILL.md", content }),
  );

  const result = await getStrictRuntimeProjectFile({
    ...baseOptions,
    fetch: fetchSpy,
    path: "skills/large/SKILL.md",
  });

  assertEquals(result?.content.length, SKILL_TEXT_FILE_MAX_BYTES);
});

Deno.test("getStrictRuntimeProjectFile allows bounded worst-case JSON escaping overhead", async () => {
  const content = "\0".repeat(SKILL_TEXT_FILE_MAX_BYTES);
  const fetchSpy = mockFetchResponses(
    jsonResponse({ path: "skills/escaped/SKILL.md", content }),
  );

  const result = await getStrictRuntimeProjectFile({
    ...baseOptions,
    fetch: fetchSpy,
    path: "skills/escaped/SKILL.md",
  });

  assertEquals(result?.content.length, SKILL_TEXT_FILE_MAX_BYTES);
});

Deno.test("getStrictRuntimeProjectFile rejects content over the byte limit", async () => {
  const content = "€".repeat(Math.floor(SKILL_TEXT_FILE_MAX_BYTES / 3) + 1);
  const fetchSpy = mockFetchResponses(
    jsonResponse({ path: "skills/large/SKILL.md", content }),
  );

  const error = await assertRejects(() =>
    getStrictRuntimeProjectFile({
      ...baseOptions,
      fetch: fetchSpy,
      path: "skills/large/SKILL.md",
    })
  );

  assertStringIncludes(
    getErrorMessage(error),
    `content exceeds ${SKILL_TEXT_FILE_MAX_BYTES} bytes`,
  );
});

Deno.test("getStrictRuntimeProjectFile rejects chunked responses over the transport limit", async () => {
  const oversizedChunk = new Uint8Array(SKILL_TEXT_FILE_MAX_BYTES * 7);
  let sentChunk = false;
  let cancelled = false;
  const fetchSpy = mockFetchResponses(
    new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sentChunk) {
            sentChunk = true;
            controller.enqueue(oversizedChunk);
          }
        },
        cancel() {
          cancelled = true;
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    ),
  );

  const error = await assertRejects(() =>
    getStrictRuntimeProjectFile({
      ...baseOptions,
      fetch: fetchSpy,
      path: "skills/large/SKILL.md",
    })
  );

  await Promise.resolve();
  assertStringIncludes(getErrorMessage(error), "Project file response exceeds");
  assertEquals(cancelled, true);
});

Deno.test("getStrictRuntimeProjectFile rejects oversized Content-Length before reading", async () => {
  let pullCount = 0;
  let cancelled = false;
  const fetchSpy = mockFetchResponses(
    streamResponse([new TextEncoder().encode("{}")], {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(SKILL_TEXT_FILE_MAX_BYTES * 7),
      },
    }, {
      onPull: () => {
        pullCount += 1;
      },
      onCancel: () => {
        cancelled = true;
      },
    }),
  );
  await Promise.resolve();
  const pullCountBeforeRequest = pullCount;

  const error = await assertRejects(() =>
    getStrictRuntimeProjectFile({
      ...baseOptions,
      fetch: fetchSpy,
      path: "skills/large/SKILL.md",
    })
  );
  await Promise.resolve();

  assertStringIncludes(getErrorMessage(error), "Project file response exceeds");
  assertEquals(pullCount, pullCountBeforeRequest);
  assertEquals(cancelled, true);
});

Deno.test("getStrictRuntimeProjectFile rejects invalid UTF-8", async () => {
  const fetchSpy = mockFetchResponses(
    streamResponse([new Uint8Array([0xc3, 0x28])], {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

  const error = await assertRejects(() =>
    getStrictRuntimeProjectFile({
      ...baseOptions,
      fetch: fetchSpy,
      path: "skills/invalid/SKILL.md",
    })
  );

  assertStringIncludes(getErrorMessage(error), "was not valid UTF-8");
});

Deno.test("getStrictRuntimeProjectFile rejects a response path that differs from the request", async () => {
  const fetchSpy = mockFetchResponses(
    jsonResponse({ path: "skills/other/SKILL.md", content: "Body" }),
  );

  const error = await assertRejects(() =>
    getStrictRuntimeProjectFile({
      ...baseOptions,
      fetch: fetchSpy,
      path: "skills/requested/SKILL.md",
    })
  );

  assertStringIncludes(getErrorMessage(error), "response path did not match the request");
});

Deno.test("getStrictRuntimeProjectFile returns null when the API file route returns 404", async () => {
  const fetchSpy = mockFetchResponses(textResponse("File not found", 404));

  const result = await getStrictRuntimeProjectFile({
    ...baseOptions,
    fetch: fetchSpy,
    path: "missing.ts",
  });

  assertEquals(result, null);
});

Deno.test("getStrictRuntimeProjectFile throws auth errors for API HTTP 401 and 403", async () => {
  const unauthorizedFetch = mockFetchResponses(textResponse("Unauthorized", 401));
  const unauthorizedError = await assertRejects(() =>
    getStrictRuntimeProjectFile({ ...baseOptions, fetch: unauthorizedFetch, path: "src/index.ts" })
  );
  assertInstanceOf(unauthorizedError, RuntimeProjectFilesApiAuthError);

  const forbiddenFetch = mockFetchResponses(textResponse("Forbidden", 403));
  const forbiddenError = await assertRejects(() =>
    getStrictRuntimeProjectFile({ ...baseOptions, fetch: forbiddenFetch, path: "src/index.ts" })
  );
  assertInstanceOf(forbiddenError, RuntimeProjectFilesApiAuthError);
});

Deno.test("getStrictRuntimeProjectFile supports a custom access-denied error factory", async () => {
  const fetchSpy = mockFetchResponses(textResponse("Forbidden", 403));

  const error = await assertRejects(() =>
    getStrictRuntimeProjectFile({
      ...baseOptions,
      fetch: fetchSpy,
      path: "src/index.ts",
      createAccessDeniedError: (statusCode, message) => new Error(`${statusCode}: ${message}`),
    })
  );

  assertEquals(getErrorMessage(error), "403: Access denied to project files API");
});

Deno.test("strict runtime project files client validates timeout and page-limit options", async () => {
  assertThrows(
    () =>
      createStrictRuntimeProjectFilesClient({
        apiUrl: baseOptions.apiUrl,
        timeoutMs: 0,
      }),
    RangeError,
    "timeoutMs",
  );
  assertThrows(
    () =>
      createStrictRuntimeProjectFilesClient({
        apiUrl: baseOptions.apiUrl,
        pageLimit: TEST_MAX_PAGE_LIMIT + 1,
      }),
    RangeError,
    "pageLimit",
  );

  const fetchSpy = mockFetchResponses(
    jsonResponse({ path: "src/index.ts", content: "hello" }),
  );
  const result = await getStrictRuntimeProjectFile({
    ...baseOptions,
    fetch: fetchSpy,
    path: "src/index.ts",
    // Pagination is irrelevant to the direct file route.
    pageLimit: TEST_MAX_PAGE_LIMIT + 1,
  });
  assertEquals(result?.content, "hello");
});

Deno.test("strict runtime project files reject unsafe transport identity and URL fields", async () => {
  let fetchCalls = 0;
  const fetchMock: RuntimeProjectFilesFetch = async () => {
    fetchCalls += 1;
    return jsonResponse({ path: "src/index.ts", content: "unused" });
  };

  for (
    const options of [
      { projectId: String.fromCharCode(0xd800), authToken: "token-1" },
      { projectId: "..", authToken: "token-1" },
      { projectId: "project/one", authToken: "token-1" },
      { projectId: "project-1\nforged", authToken: "token-1" },
      { projectId: "project-1", authToken: "token-1\nforged" },
      {
        projectId: "project-1",
        authToken: "token-1",
        branchId: String.fromCharCode(0xdc00),
      },
    ]
  ) {
    await assertRejects(
      () =>
        getStrictRuntimeProjectFile({
          apiUrl: baseOptions.apiUrl,
          fetch: fetchMock,
          path: "src/index.ts",
          ...options,
        }),
      TypeError,
    );
  }
  assertThrows(
    () => createStrictRuntimeProjectFilesClient({ apiUrl: "file:///tmp/api" }),
    TypeError,
    "HTTP(S)",
  );
  assertThrows(
    () => createStrictRuntimeProjectFilesClient({ apiUrl: "https://user:pass@example.com" }),
    TypeError,
    "credentials",
  );
  assertEquals(fetchCalls, 0);
});

Deno.test("strict runtime project files client snapshots configuration and rejects call-site overrides", async () => {
  const configuredFetch = mockFetchResponses(
    jsonResponse({ path: "src/index.ts", content: "configured" }),
  );
  let overrideFetchCalls = 0;
  const mutableOptions: {
    apiUrl: URL;
    fetch: RuntimeProjectFilesFetch;
  } = {
    apiUrl: new URL("https://api.example.com/v1"),
    fetch: configuredFetch,
  };
  const client = createStrictRuntimeProjectFilesClient(mutableOptions);

  mutableOptions.apiUrl.hostname = "mutated.example.com";
  mutableOptions.fetch = async () => {
    overrideFetchCalls += 1;
    return jsonResponse({ path: "src/index.ts", content: "mutated" });
  };

  const result = await client.getProjectFile({
    ...baseOptions,
    path: "src/index.ts",
    apiUrl: "https://override.example.com",
    fetch: mutableOptions.fetch,
  } as RuntimeGetProjectFileOptions);

  assertEquals(result?.content, "configured");
  assertEquals(getRequestedUrl(configuredFetch).origin, "https://api.example.com");
  assertEquals(overrideFetchCalls, 0);
});

Deno.test("getStrictRuntimeProjectFile reports upstream and network errors", async () => {
  const upstreamFetch = mockFetchResponses(textResponse("Internal Server Error", 500));
  const upstreamError = await assertRejects(() =>
    getStrictRuntimeProjectFile({ ...baseOptions, fetch: upstreamFetch, path: "src/index.ts" })
  );
  assertStringIncludes(
    getErrorMessage(upstreamError),
    "Failed to fetch file src/index.ts for project project-1: Internal Server Error",
  );

  const networkFetch: RuntimeProjectFilesFetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  const networkError = await assertRejects(() =>
    getStrictRuntimeProjectFile({ ...baseOptions, fetch: networkFetch, path: "src/index.ts" })
  );
  assertStringIncludes(getErrorMessage(networkError), "ECONNREFUSED");
});

Deno.test("strict runtime project files preserve timeout identity across request phases", async () => {
  const fetchTimeout = new DOMException("fetch timeout", "TimeoutError");
  const fetchError = await assertRejects(() =>
    getStrictRuntimeProjectFile({
      ...baseOptions,
      fetch: async () => {
        throw fetchTimeout;
      },
      path: "src/index.ts",
    })
  );
  assertEquals(fetchError === fetchTimeout, true);

  const fileBodyTimeout = new DOMException("file body timeout", "TimeoutError");
  const fileBodyError = await assertRejects(() =>
    getStrictRuntimeProjectFile({
      ...baseOptions,
      fetch: mockFetchResponses(erroringResponse(fileBodyTimeout)),
      path: "src/index.ts",
    })
  );
  assertEquals(fileBodyError === fileBodyTimeout, true);

  const listBodyTimeout = new DOMException("list body timeout", "TimeoutError");
  const listBodyError = await assertRejects(() =>
    getStrictRuntimeProjectFiles({
      ...baseOptions,
      fetch: mockFetchResponses(erroringResponse(listBodyTimeout)),
    })
  );
  assertEquals(listBodyError === listBodyTimeout, true);

  const timeoutCause = new DOMException("error body timeout", "TimeoutError");
  const wrappedTimeout = new Error("response body read failed", { cause: timeoutCause });
  const errorBodyError = await assertRejects(() =>
    getStrictRuntimeProjectFile({
      ...baseOptions,
      fetch: mockFetchResponses(erroringResponse(wrappedTimeout, 500)),
      path: "src/index.ts",
    })
  );
  assertEquals(errorBodyError === wrappedTimeout, true);
  assertEquals((errorBodyError as Error).cause === timeoutCause, true);
});

Deno.test("getStrictRuntimeProjectFile bounds upstream error bodies", async () => {
  const oversizedError = new Uint8Array(TEST_MAX_ERROR_BODY_BYTES + 1);
  oversizedError.fill("x".charCodeAt(0));
  const fetchSpy = mockFetchResponses(
    streamResponse([oversizedError], { status: 500 }),
  );

  const error = await assertRejects(() =>
    getStrictRuntimeProjectFile({
      ...baseOptions,
      fetch: fetchSpy,
      path: "src/index.ts",
    })
  );

  assertStringIncludes(
    getErrorMessage(error),
    `Project files API error response exceeds ${TEST_MAX_ERROR_BODY_BYTES} bytes`,
  );
  assertEquals(getErrorMessage(error).length < TEST_MAX_ERROR_BODY_BYTES, true);
});

Deno.test("getStrictRuntimeProjectFile passes project, path, branch, fields, and auth through REST", async () => {
  const fetchSpy = mockFetchResponses(jsonResponse({ path: "src/index.ts", content: "hello" }));

  await getStrictRuntimeProjectFile({
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

Deno.test("getStrictRuntimeProjectFile preserves an empty branch as the default-branch alias", async () => {
  const fetchSpy = mockFetchResponses(jsonResponse({ path: "src/index.ts", content: "hello" }));

  await getStrictRuntimeProjectFile({
    ...baseOptions,
    fetch: fetchSpy,
    path: "src/index.ts",
    branchId: "",
  });

  assertEquals(getRequestedUrl(fetchSpy).searchParams.has("branch"), false);
});

Deno.test("getStrictRuntimeProjectFiles returns project file paths from the API list route", async () => {
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

  const result = await getStrictRuntimeProjectFiles({ ...baseOptions, fetch: fetchSpy });

  assertEquals(result, files);
});

Deno.test("getStrictRuntimeProjectFiles follows API pagination until no next cursor remains", async () => {
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

  const result = await getStrictRuntimeProjectFiles({ ...baseOptions, fetch: fetchSpy });

  assertEquals(result, [{ path: "a.ts" }, { path: "b.ts" }]);
  assertEquals(getRequestedUrl(fetchSpy, 1).searchParams.get("cursor"), "cursor-2");
});

Deno.test("getStrictRuntimeProjectFiles rejects repeated pagination cursors", async () => {
  const fetchSpy = mockFetchResponses(
    jsonResponse({
      data: [{ path: "a.ts" }],
      page_info: { next: "cursor-repeat" },
    }),
    jsonResponse({
      data: [{ path: "b.ts" }],
      page_info: { next: "cursor-repeat" },
    }),
  );

  const error = await assertRejects(() =>
    getStrictRuntimeProjectFiles({ ...baseOptions, fetch: fetchSpy })
  );

  assertStringIncludes(getErrorMessage(error), "pagination returned a repeated cursor");
  assertEquals(fetchSpy.calls.length, 2);
});

Deno.test("getStrictRuntimeProjectFiles rejects pages over the item budget", async () => {
  const fetchSpy = mockFetchResponses(
    jsonResponse({
      data: Array.from(
        { length: TEST_MAX_PAGE_LIMIT + 1 },
        (_, index) => ({ path: `file-${index}.ts` }),
      ),
      page_info: { next: null },
    }),
  );

  const error = await assertRejects(() =>
    getStrictRuntimeProjectFiles({ ...baseOptions, fetch: fetchSpy })
  );

  assertStringIncludes(getErrorMessage(error), "invalid API response");
});

Deno.test("getStrictRuntimeProjectFiles enforces the requested page limit", async () => {
  const requestedPageLimit = 10;
  const fetchSpy = mockFetchResponses(
    jsonResponse({
      data: Array.from(
        { length: requestedPageLimit + 1 },
        (_, index) => ({ path: `file-${index}.ts` }),
      ),
      page_info: { next: null },
    }),
  );

  const error = await assertRejects(() =>
    getStrictRuntimeProjectFiles({
      ...baseOptions,
      fetch: fetchSpy,
      pageLimit: requestedPageLimit,
    })
  );

  assertStringIncludes(
    getErrorMessage(error),
    `page returned more than the requested ${requestedPageLimit} files`,
  );
});

Deno.test("getStrictRuntimeProjectFiles rejects oversized paths", async () => {
  const fetchSpy = mockFetchResponses(
    jsonResponse({
      data: [{ path: "x".repeat(TEST_MAX_PATH_CHARACTERS + 1) }],
      page_info: { next: null },
    }),
  );

  const error = await assertRejects(() =>
    getStrictRuntimeProjectFiles({ ...baseOptions, fetch: fetchSpy })
  );

  assertStringIncludes(getErrorMessage(error), "invalid API response");
});

Deno.test("getStrictRuntimeProjectFiles rejects ill-formed UTF-16 paths and cursors", async () => {
  const malformed = String.fromCharCode(0xd800);
  const invalidPathFetch = mockFetchResponses(
    jsonResponse({
      data: [{ path: malformed }],
      page_info: { next: null },
    }),
  );

  const pathError = await assertRejects(() =>
    getStrictRuntimeProjectFiles({ ...baseOptions, fetch: invalidPathFetch })
  );
  assertStringIncludes(getErrorMessage(pathError), "invalid API response");

  const invalidCursorFetch = mockFetchResponses(
    jsonResponse({
      data: [],
      page_info: { next: malformed },
    }),
  );
  const cursorError = await assertRejects(() =>
    getStrictRuntimeProjectFiles({ ...baseOptions, fetch: invalidCursorFetch })
  );
  assertStringIncludes(getErrorMessage(cursorError), "invalid API response");
  assertEquals(invalidCursorFetch.calls.length, 1);
});

Deno.test("getStrictRuntimeProjectFiles rejects chunked list pages over the transport limit", async () => {
  const oversizedChunk = new Uint8Array(SKILL_TEXT_FILE_MAX_BYTES * 3);
  const fetchSpy = mockFetchResponses(
    streamResponse([oversizedChunk], {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

  const error = await assertRejects(() =>
    getStrictRuntimeProjectFiles({ ...baseOptions, fetch: fetchSpy })
  );

  assertStringIncludes(getErrorMessage(error), "Project files list response exceeds");
});

Deno.test("getStrictRuntimeProjectFiles caps aggregate file count", async () => {
  const pageCount = TEST_MAX_TOTAL_FILES / TEST_MAX_PAGE_LIMIT + 1;
  const responses = Array.from({ length: pageCount }, (_, pageIndex) =>
    jsonResponse({
      data: Array.from(
        { length: TEST_MAX_PAGE_LIMIT },
        (_, itemIndex) => ({
          path: `page-${pageIndex}/file-${itemIndex}.ts`,
        }),
      ),
      page_info: { next: `cursor-${pageIndex + 1}` },
    }));
  const fetchSpy = mockFetchResponses(...responses);

  const error = await assertRejects(() =>
    getStrictRuntimeProjectFiles({ ...baseOptions, fetch: fetchSpy })
  );

  assertStringIncludes(
    getErrorMessage(error),
    `file count exceeds ${TEST_MAX_TOTAL_FILES}`,
  );
  assertEquals(fetchSpy.calls.length, pageCount);
});

Deno.test("getStrictRuntimeProjectFiles accepts exactly the aggregate file budget", async () => {
  const pageCount = TEST_MAX_TOTAL_FILES / TEST_MAX_PAGE_LIMIT;
  const responses = Array.from({ length: pageCount }, (_, pageIndex) =>
    jsonResponse({
      data: Array.from(
        { length: TEST_MAX_PAGE_LIMIT },
        (_, itemIndex) => ({
          path: `page-${pageIndex}/file-${itemIndex}.ts`,
        }),
      ),
      page_info: {
        next: pageIndex + 1 < pageCount ? `cursor-${pageIndex + 1}` : null,
      },
    }));
  const fetchSpy = mockFetchResponses(...responses);

  const files = await getStrictRuntimeProjectFiles({ ...baseOptions, fetch: fetchSpy });

  assertEquals(files.length, TEST_MAX_TOTAL_FILES);
  assertEquals(fetchSpy.calls.length, pageCount);
});

Deno.test("getStrictRuntimeProjectFiles caps pagination depth", async () => {
  const responses = Array.from({ length: TEST_MAX_TOTAL_PAGES }, (_, pageIndex) =>
    jsonResponse({
      data: [],
      page_info: { next: `cursor-${pageIndex + 1}` },
    }));
  const fetchSpy = mockFetchResponses(...responses);

  const error = await assertRejects(() =>
    getStrictRuntimeProjectFiles({ ...baseOptions, fetch: fetchSpy })
  );

  assertStringIncludes(
    getErrorMessage(error),
    `pagination exceeds ${TEST_MAX_TOTAL_PAGES} pages`,
  );
  assertEquals(fetchSpy.calls.length, TEST_MAX_TOTAL_PAGES);
});

Deno.test("getStrictRuntimeProjectFiles accepts exactly the pagination depth budget", async () => {
  const responses = Array.from({ length: TEST_MAX_TOTAL_PAGES }, (_, pageIndex) =>
    jsonResponse({
      data: [],
      page_info: {
        next: pageIndex + 1 < TEST_MAX_TOTAL_PAGES ? `cursor-${pageIndex + 1}` : null,
      },
    }));
  const fetchSpy = mockFetchResponses(...responses);

  const files = await getStrictRuntimeProjectFiles({ ...baseOptions, fetch: fetchSpy });

  assertEquals(files, []);
  assertEquals(fetchSpy.calls.length, TEST_MAX_TOTAL_PAGES);
});

Deno.test("getStrictRuntimeProjectFiles throws auth errors for API HTTP 401 and 403", async () => {
  const unauthorizedFetch = mockFetchResponses(textResponse("Unauthorized", 401));
  const unauthorizedError = await assertRejects(() =>
    getStrictRuntimeProjectFiles({ ...baseOptions, fetch: unauthorizedFetch })
  );
  assertInstanceOf(unauthorizedError, RuntimeProjectFilesApiAuthError);

  const forbiddenFetch = mockFetchResponses(textResponse("Forbidden", 403));
  const forbiddenError = await assertRejects(() =>
    getStrictRuntimeProjectFiles({ ...baseOptions, fetch: forbiddenFetch })
  );
  assertInstanceOf(forbiddenError, RuntimeProjectFilesApiAuthError);
});

Deno.test("getStrictRuntimeProjectFiles reports upstream and network errors", async () => {
  const notFoundFetch = mockFetchResponses(textResponse("Project not found", 404));
  const notFoundError = await assertRejects(() =>
    getStrictRuntimeProjectFiles({ ...baseOptions, fetch: notFoundFetch })
  );
  assertStringIncludes(getErrorMessage(notFoundError), "Project not found");

  const upstreamFetch = mockFetchResponses(textResponse("Internal Server Error", 500));
  const upstreamError = await assertRejects(() =>
    getStrictRuntimeProjectFiles({ ...baseOptions, fetch: upstreamFetch })
  );
  assertStringIncludes(getErrorMessage(upstreamError), "Internal Server Error");

  const networkFetch: RuntimeProjectFilesFetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  const networkError = await assertRejects(() =>
    getStrictRuntimeProjectFiles({ ...baseOptions, fetch: networkFetch })
  );
  assertStringIncludes(getErrorMessage(networkError), "ECONNREFUSED");
});

Deno.test("getStrictRuntimeProjectFiles passes project, branch, fields, pagination limit, and auth through REST", async () => {
  const fetchSpy = mockFetchResponses(jsonResponse({ data: [], page_info: { next: null } }));

  await getStrictRuntimeProjectFiles({ ...baseOptions, fetch: fetchSpy, branchId: "branch-1" });

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

Deno.test("getStrictRuntimeProjectFiles preserves an empty branch as the default-branch alias", async () => {
  const fetchSpy = mockFetchResponses(jsonResponse({ data: [], page_info: { next: null } }));

  await getStrictRuntimeProjectFiles({ ...baseOptions, fetch: fetchSpy, branchId: "" });

  assertEquals(getRequestedUrl(fetchSpy).searchParams.has("branch"), false);
});
