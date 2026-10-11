import { assertEquals, assertExists, assertStrictEquals } from "#std/assert";
import type React from "./react.ts";
import * as ReactShim from "./react.ts";
import { cloneElement, createElement, createRef, useLayoutEffect, useReducer } from "./react.ts";

Deno.test("react shim forwards the upstream React surface", () => {
  assertEquals(typeof useReducer, "function");
  assertEquals(typeof useLayoutEffect, "function");
  assertEquals(typeof createRef, "function");
  assertEquals(typeof cloneElement, "function");

  const component: React.FC<{ title: string }> = (props) => createElement("span", props);
  const typedElement: React.ReactNode = createElement(component, { title: "typed" });
  assertExists(typedElement);

  const element = createElement("span", { title: "before" });
  const cloned = cloneElement(element, { title: "after" });
  assertExists(cloned);
  assertEquals(cloned.props.title, "after");
});

Deno.test("react shim exports every upstream runtime export", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(new URL("./deno.json", import.meta.url)),
  ) as { imports?: Record<string, string> };
  const upstreamTarget = config.imports?.["@veryfront/react-upstream"];
  assertExists(upstreamTarget);

  const upstream = await import(upstreamTarget);

  assertEquals(
    Object.keys(ReactShim).toSorted(),
    Object.keys(upstream).toSorted(),
  );
  assertStrictEquals(ReactShim.default, upstream.default);
});
