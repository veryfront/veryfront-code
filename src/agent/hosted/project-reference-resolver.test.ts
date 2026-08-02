import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { resolveHostedProjectReference } from "./project-reference-resolver.ts";
import { MAX_OPAQUE_ID_CODE_UNITS } from "#veryfront/utils/project-identity.ts";

Deno.test("resolveHostedProjectReference binds normalized API identity to the request", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; authorization: string | null }> = [];

  try {
    globalThis.fetch = (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(
          typeof init === "object" && init !== null
            ? Reflect.get(init, "headers") as HeadersInit | undefined
            : undefined,
        ).get("authorization"),
      });
      return Promise.resolve(
        Response.json({
          id: "11111111-1111-4111-8111-111111111111",
          slug: " target-project ",
        }),
      );
    };

    assertEquals(
      await resolveHostedProjectReference({
        projectReference: "target-project",
        authToken: "token-1",
        apiUrl: "https://api.example.test",
      }),
      {
        projectId: "11111111-1111-4111-8111-111111111111",
        slug: "target-project",
      },
    );
    assertEquals(requests, [{
      url: "https://api.example.test/projects/target-project",
      authorization: "Bearer token-1",
    }]);

    globalThis.fetch = () =>
      Promise.resolve(
        Response.json({
          id: "22222222-2222-4222-8222-222222222222",
          slug: "different-project",
        }),
      );

    await assertRejects(
      () =>
        resolveHostedProjectReference({
          projectReference: "target-project",
          authToken: "token-1",
          apiUrl: "https://api.example.test",
        }),
      Error,
      "Project lookup response did not confirm the requested project identity",
    );

    let invalidReferenceFetchCount = 0;
    globalThis.fetch = () => {
      invalidReferenceFetchCount += 1;
      throw new Error("invalid project references must not reach fetch");
    };
    for (
      const projectReference of [
        "",
        " target-project",
        "target-\nproject",
        "p".repeat(MAX_OPAQUE_ID_CODE_UNITS + 1),
      ]
    ) {
      await assertRejects(
        () =>
          resolveHostedProjectReference({
            projectReference,
            authToken: "token-1",
            apiUrl: "https://api.example.test",
          }),
        TypeError,
        "Project reference must be a trimmed non-empty bounded identifier without control characters",
      );
    }
    assertEquals(invalidReferenceFetchCount, 0);

    let cancellationCount = 0;
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              cancellationCount += 1;
              throw new Error("cleanup failed");
            },
          }),
          { status: 502 },
        ),
      );
    await assertRejects(
      () =>
        resolveHostedProjectReference({
          projectReference: "target-project",
          authToken: "token-1",
          apiUrl: "https://api.example.test",
        }),
      Error,
      "Project lookup failed (502)",
    );
    assertEquals(cancellationCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
