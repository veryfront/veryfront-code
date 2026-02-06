import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseLoginMethod } from "./utils.ts";
import type { ParsedArgs } from "../shared/types.ts";

function args(overrides: Record<string, unknown> = {}): ParsedArgs {
  return { _: [], ...overrides } as ParsedArgs;
}

describe("parseLoginMethod", () => {
  it("should return undefined when no method specified", () => {
    assertEquals(parseLoginMethod(args()), undefined);
  });

  it("should detect google", () => {
    assertEquals(parseLoginMethod(args({ google: true })), "google");
  });

  it("should detect github", () => {
    assertEquals(parseLoginMethod(args({ github: true })), "github");
  });

  it("should detect microsoft", () => {
    assertEquals(parseLoginMethod(args({ microsoft: true })), "microsoft");
  });

  it("should detect token", () => {
    assertEquals(parseLoginMethod(args({ token: true })), "token");
  });

  it("should prioritize google over others", () => {
    assertEquals(parseLoginMethod(args({ google: true, github: true })), "google");
  });

  it("should prioritize github over microsoft and token", () => {
    assertEquals(parseLoginMethod(args({ github: true, microsoft: true, token: true })), "github");
  });

  it("should skip false values", () => {
    assertEquals(parseLoginMethod(args({ google: false, github: false, token: true })), "token");
  });

  it("should return undefined when all are false", () => {
    assertEquals(parseLoginMethod(args({ google: false, github: false })), undefined);
  });
});
