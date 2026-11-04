import { assertEquals, assertExists, assertStrictEquals } from "#std/assert";
import type ReactDOMClient from "./react-dom-client.ts";
import type ReactDOMServer from "./react-dom-server.ts";
import type ReactDOM from "./react-dom.ts";
// The upstream browser server build opens a MessageChannel when its module is evaluated. Loading the
// DOM shims here, at module load, keeps that port out of the op sanitizer of the test that reads them;
// importing them inside the test made it fail whenever no earlier test in the process had loaded them.
import * as client from "./react-dom-client.ts";
import * as server from "./react-dom-server.ts";
import * as dom from "./react-dom.ts";
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

Deno.test("React DOM shims preserve upstream defaults and exports", async () => {
  const createRoot: typeof ReactDOMClient.createRoot = client.default.createRoot;
  const renderToString: typeof ReactDOMServer.renderToString = server.default.renderToString;
  const createPortal: typeof ReactDOM.createPortal = dom.default.createPortal;
  assertStrictEquals(createRoot, client.createRoot);
  assertStrictEquals(renderToString, server.renderToString);
  assertStrictEquals(createPortal, dom.createPortal);
  const config = JSON.parse(await Deno.readTextFile(new URL("./deno.json", import.meta.url))) as {
    imports: Record<string, string>;
  };
  for (
    const [shim, alias] of [
      [client, "@veryfront/react-dom-client-upstream"],
      [server, "@veryfront/react-dom-server-upstream"],
      [dom, "@veryfront/react-dom-upstream"],
    ] as const
  ) {
    const target = config.imports[alias];
    assertExists(target);
    const upstream = await import(target);
    assertEquals(Object.keys(shim).toSorted(), Object.keys(upstream).toSorted());
    assertStrictEquals(shim.default, upstream.default);
  }
});
