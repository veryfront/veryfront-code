import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertMatch } from "std/assert/mod.ts";
import { generateId, createIdGenerator } from "../../../src/ai/utils/id.ts";

describe("generateId", () => {
  it("generates 16-char ID without prefix", () => {
    const id = generateId();
    assertEquals(id.length, 16);
    assertMatch(id, /^[a-f0-9]+$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set([generateId(), generateId(), generateId()]);
    assertEquals(ids.size, 3);
  });

  it("generates ID with prefix", () => {
    const id = generateId("msg");
    assertMatch(id, /^msg_[a-f0-9]{12}$/);
  });

  it("generates ID with text prefix", () => {
    const id = generateId("text");
    assertMatch(id, /^text_[a-f0-9]{12}$/);
  });
});

describe("createIdGenerator", () => {
  it("creates generator with fixed prefix", () => {
    const gen = createIdGenerator("msg");
    const id = gen();
    assertMatch(id, /^msg_[a-f0-9]{12}$/);
  });

  it("generates unique IDs from same generator", () => {
    const gen = createIdGenerator("test");
    const ids = new Set([gen(), gen(), gen()]);
    assertEquals(ids.size, 3);
  });
});
