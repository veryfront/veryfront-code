import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { MAX_OPAQUE_ID_CODE_UNITS } from "#veryfront/utils/project-identity.ts";
import { resolveHostedProjectReference } from "./project-reference-resolver.ts";

const LOOKUP_INPUT = {
  projectReference: "target-project",
  authToken: "token-1",
  apiUrl: "https://api.example.test",
};

async function withMockFetch<T>(
  mockFetch: typeof globalThis.fetch,
  operation: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function assertLookupFailure(mockFetch: typeof globalThis.fetch): Promise<void> {
  await withMockFetch(mockFetch, () =>
    assertRejects(
      () => resolveHostedProjectReference(LOOKUP_INPUT),
      Error,
      "Project lookup failed (502)",
    ));
}

Deno.test("resolveHostedProjectReference returns a matching normalized API identity", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];

  await withMockFetch(
    (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Promise.resolve(
        Response.json({
          id: "11111111-1111-4111-8111-111111111111",
          slug: " target-project ",
        }),
      );
    },
    async () => {
      assertEquals(await resolveHostedProjectReference(LOOKUP_INPUT), {
        projectId: "11111111-1111-4111-8111-111111111111",
        slug: "target-project",
      });
    },
  );

  assertEquals(requests, [{
    url: "https://api.example.test/projects/target-project",
    authorization: "Bearer token-1",
  }]);
});

Deno.test("resolveHostedProjectReference rejects an API identity that does not match the request", async () => {
  await withMockFetch(
    () =>
      Promise.resolve(
        Response.json({
          id: "22222222-2222-4222-8222-222222222222",
          slug: "different-project",
        }),
      ),
    async () => {
      await assertRejects(
        () => resolveHostedProjectReference(LOOKUP_INPUT),
        Error,
        "Project lookup response did not confirm the requested project identity",
      );
    },
  );
});

Deno.test("resolveHostedProjectReference rejects unsafe references before fetch", async () => {
  let fetchCount = 0;

  await withMockFetch(
    () => {
      fetchCount += 1;
      throw new Error("invalid project references must not reach fetch");
    },
    async () => {
      for (
        const projectReference of [
          "",
          " target-project",
          "target-\nproject",
          "p".repeat(MAX_OPAQUE_ID_CODE_UNITS + 1),
        ]
      ) {
        await assertRejects(
          () => resolveHostedProjectReference({ ...LOOKUP_INPUT, projectReference }),
          TypeError,
          "Project reference must be a trimmed non-empty bounded identifier without control characters",
        );
      }
    },
  );

  assertEquals(fetchCount, 0);
});

Deno.test("resolveHostedProjectReference preserves lookup failure when cancellation rejects", async () => {
  let cancellationCount = 0;

  await assertLookupFailure(() =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          cancel() {
            cancellationCount += 1;
            return Promise.reject(new Error("cleanup failed"));
          },
        }),
        { status: 502 },
      ),
    )
  );
  await Promise.resolve();

  assertEquals(cancellationCount, 1);
});

Deno.test("resolveHostedProjectReference preserves lookup failure when cancellation throws", async () => {
  let cancellationCount = 0;

  await assertLookupFailure(() =>
    Promise.resolve({
      ok: false,
      status: 502,
      body: {
        cancel() {
          cancellationCount += 1;
          throw new Error("cleanup failed");
        },
      },
    } as unknown as Response)
  );

  assertEquals(cancellationCount, 1);
});

Deno.test("resolveHostedProjectReference does not await stalled error-body cancellation", async () => {
  let cancellationStarted = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  await withMockFetch(
    () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              cancellationStarted = true;
              return new Promise<void>(() => {});
            },
          }),
          { status: 502 },
        ),
      ),
    async () => {
      const timeout = new Promise<"timed-out">((resolve) => {
        timeoutId = setTimeout(() => resolve("timed-out"), 100);
      });

      try {
        const outcome = await Promise.race([
          resolveHostedProjectReference(LOOKUP_INPUT).then(
            () => "resolved",
            (error) => error instanceof Error ? error.message : "non-error rejection",
          ),
          timeout,
        ]);

        assertEquals(outcome, "Project lookup failed (502)");
        assertEquals(cancellationStarted, true);
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
    },
  );
});
