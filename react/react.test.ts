import { assertEquals, assertExists } from "#std/assert";
import { cloneElement, createElement, createRef, useLayoutEffect, useReducer } from "./react.ts";

Deno.test("react shim forwards the upstream React surface", () => {
  assertEquals(typeof useReducer, "function");
  assertEquals(typeof useLayoutEffect, "function");
  assertEquals(typeof createRef, "function");
  assertEquals(typeof cloneElement, "function");

  const element = createElement("span", { title: "before" });
  const cloned = cloneElement(element, { title: "after" });
  assertExists(cloned);
  assertEquals(cloned.props.title, "after");
});
