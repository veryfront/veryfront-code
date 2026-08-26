import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { isMissingOpenTelemetryNodeTelemetryProviderError } from "./cloud-agent-provider-bootstrap.ts";

Deno.test("OpenTelemetry bootstrap distinguishes an absent extension from transitive failures", () => {
  const expectedSource =
    "/app/node_modules/veryfront/esm/extensions/ext-observability-opentelemetry/src/index.ts";
  const missingExtension = Object.assign(
    new Error(
      `Unable to load ${expectedSource}\n  Caused by:\n    The system cannot find the path specified. (os error 3)`,
    ),
    { code: "ERR_MODULE_NOT_FOUND" },
  );
  const missingTransitiveFile = Object.assign(
    new Error(
      "Unable to load /app/node_modules/@veryfront/ext-observability-opentelemetry/esm/src/helper.ts\n" +
        "  Caused by:\n    No such file or directory (os error 2)",
    ),
    { code: "ERR_MODULE_NOT_FOUND" },
  );
  const missingPackage = Object.assign(
    new Error(
      "Cannot find package '@veryfront/ext-observability-opentelemetry' imported from " +
        "'file:///app/node_modules/veryfront/esm/src/agent/hosted/cloud-agent-provider-bootstrap.js'",
    ),
    { code: "ERR_MODULE_NOT_FOUND" },
  );

  assertEquals(isMissingOpenTelemetryNodeTelemetryProviderError(missingExtension), true);
  assertEquals(isMissingOpenTelemetryNodeTelemetryProviderError(missingPackage), true);
  assertEquals(isMissingOpenTelemetryNodeTelemetryProviderError(missingTransitiveFile), false);
});
