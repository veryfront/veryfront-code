import { assertEquals, assertThrows } from "@std/assert";
import { admitProjectsConfig, admitProjectsResponse, getProjectUrl } from "./App.tsx";

Deno.test("project links preserve the current scheme and validated port", () => {
  assertEquals(
    getProjectUrl(
      { domain: "veryfront.test", port: "8443" },
      "my-project",
      "https://veryfront.test/_projects?ignored=yes",
    ),
    "https://my-project.veryfront.test:8443/",
  );
});

Deno.test("project links reject metadata that can change URL structure", () => {
  const location = "https://veryfront.test/_projects";
  for (const slug of ["", "UPPER", "-prefix", "suffix-", "bad/path", "a".repeat(64)]) {
    assertEquals(getProjectUrl({ domain: "veryfront.test", port: "443" }, slug, location), null);
  }
  for (const domain of ["VERYFRONT.test", ".test", "test.", "user@test", "test/path"]) {
    assertEquals(getProjectUrl({ domain, port: "443" }, "project", location), null);
  }
  for (const port of ["0", "01", "65536", "443/path", "-1"]) {
    assertEquals(getProjectUrl({ domain: "veryfront.test", port }, "project", location), null);
  }
  assertEquals(
    getProjectUrl({ domain: "veryfront.test", port: "443" }, "project", "javascript:alert(1)"),
    null,
  );
});

Deno.test("projects API admission rejects malformed and ambiguous records", () => {
  assertEquals(
    admitProjectsResponse({
      data: [{
        id: "project-id",
        name: "Project",
        slug: "project",
        description: "Description",
        updated_at: "2026-07-30T20:00:00.000Z",
      }],
    }),
    [{
      id: "project-id",
      name: "Project",
      slug: "project",
      description: "Description",
      updated_at: "2026-07-30T20:00:00.000Z",
    }],
  );

  assertThrows(
    () =>
      admitProjectsResponse({
        data: [
          { id: "same", name: "First", slug: "first" },
          { id: "same", name: "Second", slug: "second" },
        ],
      }),
    TypeError,
    "duplicate id",
  );
  assertThrows(
    () => admitProjectsResponse({ data: [{ id: "id", name: "Project", slug: "../bad" }] }),
    TypeError,
    "canonical hostname",
  );
  assertThrows(() => admitProjectsResponse({ data: "invalid" }), TypeError, "must be an array");

  assertEquals(
    admitProjectsConfig({ domain: "veryfront.test", port: "3000", hasToken: true }),
    { domain: "veryfront.test", port: "3000", hasToken: true },
  );
  assertThrows(
    () => admitProjectsConfig({ domain: "veryfront.test/path", port: "3000", hasToken: true }),
    TypeError,
    "canonical hostname",
  );
});
