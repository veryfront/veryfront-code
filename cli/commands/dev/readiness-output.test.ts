import { assertEquals, assertStringIncludes } from "@std/assert";
import { devReadinessLines, veryfrontServiceName } from "./readiness-output.ts";

Deno.test("local service readiness distinguishes app, connection, and execution", () => {
  const output = devReadinessLines({
    appUrl: "http://localhost:3551",
    connection: {
      apiUrl: "http://localhost:4400",
      project: "example",
      environment: "preview",
      signedIn: "test@example.com",
      studioUrl: "http://localhost:3440/projects/example?panels=runs",
    },
  }).join("\n");
  assertStringIncludes(output, "✓ App ready       http://localhost:3551");
  assertStringIncludes(output, "✓ Connected       Local Veryfront · http://localhost:4400");
  assertStringIncludes(output, "Environment     preview (shared)");
  assertStringIncludes(output, "Execution       This machine");
  assertEquals(output.includes("Cloud"), false);
});
Deno.test("remote connection and local-only readiness remain explicit", () => {
  assertEquals(veryfrontServiceName("https://api.veryfront.com"), "Veryfront Cloud");
  assertEquals(veryfrontServiceName("http://127.0.0.1:4400"), "Local Veryfront");
  const remote = devReadinessLines({
    appUrl: "http://localhost:3000",
    connection: {
      apiUrl: "https://api.veryfront.com",
      project: "example",
      environment: "preview",
      studioUrl: "https://veryfront.com/projects/example?panels=runs",
    },
  }).join("\n");
  assertStringIncludes(remote, "✓ Connected       Veryfront Cloud · https://api.veryfront.com");
  assertStringIncludes(remote, "Execution       This machine");
  const output = devReadinessLines({ appUrl: "http://localhost:3000" }).join("\n");
  assertStringIncludes(output, "Not linked");
  assertEquals(output.includes("✓ Connected"), false);
});
