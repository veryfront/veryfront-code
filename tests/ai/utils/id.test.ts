import { describe, it } from "@veryfront/testing/bdd";
import { assertEquals, assertMatch } from "@veryfront/testing/assert";
import { createIdGenerator, generateId } from "../../../src/utils/id.ts";

describe("generateId", () => {
  it("generates 16-char alphanumeric ID without prefix", () => {
    const id = generateId();
    assertEquals(id.length, 16);
    assertMatch(id, /^[a-zA-Z0-9]+$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set([generateId(), generateId(), generateId()]);
    assertEquals(ids.size, 3);
  });

  it("generates ID with prefix using dash separator", () => {
    const id = generateId("msg");
    assertMatch(id, /^msg-[a-zA-Z0-9]{16}$/);
  });

  it("generates ID with text prefix", () => {
    const id = generateId("text");
    assertMatch(id, /^text-[a-zA-Z0-9]{16}$/);
  });
});

describe("createIdGenerator", () => {
  it("creates generator with fixed prefix (dash separator)", () => {
    const gen = createIdGenerator({ prefix: "msg" });
    const id = gen();
    assertMatch(id, /^msg-[a-zA-Z0-9]{16}$/);
  });

  it("creates generator with custom size", () => {
    const gen = createIdGenerator({ prefix: "user", size: 8 });
    const id = gen();
    assertMatch(id, /^user-[a-zA-Z0-9]{8}$/);
  });

  it("creates generator with custom separator", () => {
    const gen = createIdGenerator({ prefix: "id", separator: "_" });
    const id = gen();
    assertMatch(id, /^id_[a-zA-Z0-9]{16}$/);
  });

  it("generates unique IDs from same generator", () => {
    const gen = createIdGenerator({ prefix: "test" });
    const ids = new Set([gen(), gen(), gen()]);
    assertEquals(ids.size, 3);
  });
});
