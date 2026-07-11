import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { reserveProjectSlug } from "./reserve-slug.ts";

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
