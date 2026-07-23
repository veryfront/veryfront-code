import { assertEquals, assertStringIncludes } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  formatConnectorIconFailure,
  formatConnectorIdentityMismatch,
  formatConnectorSourceFailure,
  formatConnectorSourceMetadataFailure,
  formatGeneratedModuleEntries,
  isConnectorSourceRecord,
} from "./integrations-module-format.ts";

describe("formatGeneratedModuleEntries", () => {
  it("does not emit a dangling comma when there are no entries", () => {
    const output = formatGeneratedModuleEntries([]);

    assertEquals(output, "");
  });

  it("emits a trailing comma only when entries are present", () => {
    const output = formatGeneratedModuleEntries(["  one", "  two"]);

    assertStringIncludes(output, "  one,\n  two,");
  });
});

describe("formatConnectorSourceFailure", () => {
  it("reports a missing connector file without exposing its path", () => {
    assertEquals(
      formatConnectorSourceFailure(
        "github",
        new Deno.errors.NotFound("missing"),
      ),
      "github: connector.json not found",
    );
  });

  it("reports malformed and unreadable sources without exposing raw errors", () => {
    for (
      const error of [
        new SyntaxError("PRIVATE_JSON_ERROR_CANARY"),
        new Deno.errors.PermissionDenied(
          "/private/connector.json PRIVATE_PATH_CANARY",
        ),
        new Error("PRIVATE_PROGRAMMER_ERROR_CANARY"),
      ]
    ) {
      assertEquals(
        formatConnectorSourceFailure("github", error),
        "github: failed to load connector.json",
      );
    }
  });

  it("sanitizes an unexpected connector directory name", () => {
    assertEquals(
      formatConnectorSourceFailure(
        "../../PRIVATE_CONNECTOR_CANARY",
        new SyntaxError("PRIVATE_JSON_ERROR_CANARY"),
      ),
      "<invalid-connector>: failed to load connector.json",
    );
  });
});

describe("connector source metadata", () => {
  it("accepts only object sources with typed internal and semver metadata", () => {
    assertEquals(isConnectorSourceRecord({ name: "github" }), true);
    assertEquals(isConnectorSourceRecord({ internal: true, version: "1.2.3-beta.1" }), true);
    assertEquals(isConnectorSourceRecord(null), false);
    assertEquals(isConnectorSourceRecord([]), false);
    assertEquals(isConnectorSourceRecord({ internal: "false" }), false);
    assertEquals(isConnectorSourceRecord({ version: "file:/private" }), false);
  });

  it("sanitizes source metadata failures", () => {
    assertEquals(
      formatConnectorSourceMetadataFailure("github"),
      "github: connector.json has invalid source metadata",
    );
    assertEquals(
      formatConnectorSourceMetadataFailure("../../PRIVATE_CONNECTOR_CANARY"),
      "<invalid-connector>: connector.json has invalid source metadata",
    );
  });
});

describe("formatConnectorIconFailure", () => {
  it("distinguishes a missing icon from other sanitized read failures", () => {
    assertEquals(
      formatConnectorIconFailure(
        "github",
        new Deno.errors.NotFound("PRIVATE_PATH_CANARY"),
      ),
      "github: declared icon file not found",
    );
    assertEquals(
      formatConnectorIconFailure(
        "github",
        new Deno.errors.PermissionDenied("PRIVATE_PATH_CANARY"),
      ),
      "github: failed to load declared icon",
    );
  });

  it("sanitizes an unexpected connector directory name", () => {
    assertEquals(
      formatConnectorIconFailure(
        "../../PRIVATE_CONNECTOR_CANARY",
        new Error("private"),
      ),
      "<invalid-connector>: failed to load declared icon",
    );
  });
});

describe("formatConnectorIdentityMismatch", () => {
  it("reports the invariant without exposing an unsafe directory name", () => {
    assertEquals(
      formatConnectorIdentityMismatch("github"),
      "github: connector name must match its directory name",
    );
    assertEquals(
      formatConnectorIdentityMismatch("../../PRIVATE_CONNECTOR_CANARY"),
      "<invalid-connector>: connector name must match its directory name",
    );
  });
});
