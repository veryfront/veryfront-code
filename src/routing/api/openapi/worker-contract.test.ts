import "#veryfront/schemas/_test-setup.ts";
import { assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_OPENAPI_WORKER_MODULE_BYTES } from "#veryfront/security/sandbox/worker-types.ts";
import type { GenerateOpenAPISpecRequest } from "#veryfront/security/sandbox/worker-types.ts";
import { assertValidOpenAPIWorkerRequest } from "./worker-contract.ts";

function request(): GenerateOpenAPISpecRequest {
  return {
    type: "generate-openapi-spec",
    id: "request-test",
    projectDir: "/project",
    routes: [{ pattern: "/api/users", moduleCode: "export function GET() {}" }],
    info: {
      title: "Example API",
      version: "1.0.0",
      servers: [{ url: "https://example.com" }],
    },
    sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
  };
}

describe("OpenAPI worker request contract", () => {
  it("rejects an individual executable module above the transfer bound", () => {
    const value = request();
    value.routes[0]!.moduleCode = "x".repeat(MAX_OPENAPI_WORKER_MODULE_BYTES + 1);

    assertThrows(
      () => assertValidOpenAPIWorkerRequest(value),
      TypeError,
      "module code is invalid",
    );
  });

  it("rejects duplicate route patterns", () => {
    const value = request();
    value.routes.push({ ...value.routes[0]! });

    assertThrows(
      () => assertValidOpenAPIWorkerRequest(value),
      TypeError,
      "route pattern is invalid",
    );
  });

  it("rejects credential-bearing server URLs", () => {
    const value = request();
    value.info.servers = [{ url: "https://user:secret@example.com" }];

    assertThrows(
      () => assertValidOpenAPIWorkerRequest(value),
      TypeError,
      "server URL is not allowed",
    );
  });

  it("rejects an invalid source integration policy", () => {
    const value = request();
    value.sourceIntegrationPolicy = { schemaVersion: 2, mode: "unrestricted" } as never;

    assertThrows(
      () => assertValidOpenAPIWorkerRequest(value),
      TypeError,
      "Invalid source integration policy manifest",
    );
  });

  it("rejects invalid and oversized project environment snapshots", () => {
    const invalid = request();
    invalid.projectEnv = { "invalid-key": "value" };
    assertThrows(
      () => assertValidOpenAPIWorkerRequest(invalid),
      TypeError,
      "project environment is invalid",
    );

    const oversized = request();
    oversized.projectEnv = Object.fromEntries(
      Array.from({ length: 513 }, (_, index) => [`VALID_ENV_${index}`, "value"]),
    );
    assertThrows(
      () => assertValidOpenAPIWorkerRequest(oversized),
      RangeError,
      "project environment exceeds the key limit",
    );
  });
});
