import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { ProjectSlugConflictError, reserveProjectSlug } from "./reserve-slug.ts";

describe("reserveProjectSlug", () => {
  it("reserves a first-push project on the resolved control plane", async () => {
    let requestUrl = "";

    const result = await withMockFetch(async (input: string | URL | Request) => {
      const request = input instanceof Request ? input : new Request(input);
      requestUrl = request.url;
      return Response.json({ id: "550e8400-e29b-41d4-a716-446655440000" });
    }, () =>
      reserveProjectSlug(
        "my-project",
        "token",
        undefined,
        "https://control.example.test/api",
      ));

    assertEquals(requestUrl, "https://control.example.test/api/projects");
    assertEquals(result, {
      slug: "my-project",
      projectId: "550e8400-e29b-41d4-a716-446655440000",
      created: true,
    });
  });

  it("does not create an alternative project for an explicit slug", async () => {
    let requests = 0;
    await assertRejects(
      () =>
        withMockFetch(() => {
          requests++;
          return Promise.resolve(Response.json({ error: "taken" }, { status: 409 }));
        }, () =>
          reserveProjectSlug(
            "my-project",
            "token",
            undefined,
            "https://control.example.test/api",
            { allowAlternativeSlug: false },
          )),
      ProjectSlugConflictError,
      "already in use",
    );
    assertEquals(requests, 1);
  });
});
