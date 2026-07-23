import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertResourceId,
  assertResourceUri,
  compileResourcePattern,
  decodeResourceParams,
  GENERATED_RESOURCE_PATTERN,
  hasUnresolvedGeneratedResourcePattern,
  matchResourcePattern,
} from "./pattern.ts";

describe("resource pattern compiler", () => {
  it("treats an opaque URI scheme payload as literal text", () => {
    const compiled = compileResourcePattern("urn:example:animal:ferret:nose");

    assertEquals(compiled.parameterNames, []);
    assertEquals(matchResourcePattern("urn:example:animal:ferret:nose", compiled), []);
    assertEquals(matchResourcePattern("urn:example:animal:otter:nose", compiled), null);
  });

  it("still supports parameters after the path begins in a scheme URI", () => {
    const compiled = compileResourcePattern("resource://items/:id");

    assertEquals(compiled.parameterNames, ["id"]);
    assertEquals(matchResourcePattern("resource://items/42", compiled), ["42"]);
    assertEquals(compiled.uriTemplate, "resource://items/{id}");
  });

  it("treats hierarchical URI authority colons as literal text", () => {
    const compiled = compileResourcePattern("resource://catalog:primary/items/:id");

    assertEquals(compiled.parameterNames, ["id"]);
    assertEquals(
      matchResourcePattern("resource://catalog:primary/items/42", compiled),
      ["42"],
    );
    assertEquals(compiled.uriTemplate, "resource://catalog:primary/items/{id}");
  });

  it("rejects ambiguous, duplicate, excessive, and malformed patterns", () => {
    assertThrows(() => compileResourcePattern(42), Error);
    assertThrows(() => compileResourcePattern("/:first:second"), Error);
    assertThrows(() => compileResourcePattern("/:first-:second"), Error);
    assertThrows(() => compileResourcePattern("/:id/:id"), Error);
    assertThrows(() => compileResourcePattern("/%ZZ"), Error);
    assertThrows(() => compileResourcePattern("/literal/{template}/:id"), Error);
    assertThrows(() => compileResourcePattern("/windows\\separator"), Error);
    assertThrows(() => compileResourcePattern(`/${"segment/".repeat(128)}`), Error);
    assertThrows(
      () =>
        compileResourcePattern(
          Array.from({ length: 33 }, (_, index) => `/:p${index}`).join(""),
        ),
      Error,
    );
  });

  it("rejects unsafe or unbounded ids and URIs", () => {
    for (const id of ["", "with space", "unsafe\u202evalue", "x".repeat(513)]) {
      assertThrows(() => assertResourceId(id), Error);
    }
    for (
      const uri of [
        "",
        "/with space",
        "/unsafe\u202evalue",
        "/%ZZ",
        "/literal/{template}",
        "/windows\\separator",
        "x".repeat(8193),
      ]
    ) {
      assertThrows(() => assertResourceUri(uri), Error);
    }
  });

  it("identifies unresolved generated patterns without trusting accessors", () => {
    const pattern = "/resource_generated";
    assertEquals(
      hasUnresolvedGeneratedResourcePattern({
        pattern,
        [GENERATED_RESOURCE_PATTERN]: pattern,
      }),
      true,
    );
    assertEquals(hasUnresolvedGeneratedResourcePattern(null), false);
    assertThrows(
      () =>
        hasUnresolvedGeneratedResourcePattern(
          Object.defineProperty({}, GENERATED_RESOURCE_PATTERN, {
            get() {
              throw new Error("unreadable");
            },
          }),
        ),
      Error,
    );
  });

  it("fails closed when capture metadata and values do not align", () => {
    const compiled = compileResourcePattern("/users/:id");
    assertThrows(() => decodeResourceParams([], compiled), Error);
    assertThrows(() => decodeResourceParams(["%ZZ"], compiled), Error);
  });
});
