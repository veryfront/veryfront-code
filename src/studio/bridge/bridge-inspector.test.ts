import "#veryfront/schemas/_test-setup.ts";
import { FakeTime } from "#std/testing/time";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { setConfigForTest } from "./bridge-config.ts";
import {
  _bridgeCreatedSelectorCountForTest,
  buildNavigatorTree,
  buildSelectedNodeDetails,
  createOverlay,
  disposeInspector,
  findElementById,
  scrollToElement,
  setColorMode,
  setupInspectMode,
  setupMutationObserver,
} from "./bridge-inspector.ts";
import { state } from "./bridge-state.ts";

const originalDocument = globalThis.document;
const originalNode = globalThis.Node;
const originalMutationObserver = globalThis.MutationObserver;
const originalWindow = globalThis.window;
const originalCSS = globalThis.CSS;

afterEach(() => {
  disposeInspector();
  state.inspectMode = false;
  state.selectedNodeId = null;
  state.hoveredNodeId = null;
  state.selectionOverlay = null;
  state.hoverOverlay = null;
  Object.defineProperty(globalThis, "document", {
    value: originalDocument,
    configurable: true,
  });
  Object.defineProperty(globalThis, "Node", {
    value: originalNode,
    configurable: true,
  });
  Object.defineProperty(globalThis, "MutationObserver", {
    value: originalMutationObserver,
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: originalWindow,
    configurable: true,
  });
  Object.defineProperty(globalThis, "CSS", {
    value: originalCSS,
    configurable: true,
  });
});

describe("studio/bridge/bridge-inspector", () => {
  it("excludes bridge overlays from navigator and screenshot capture", () => {
    const created: Array<{ attributes: Map<string, string> }> = [];
    const fakeDocument = {
      createElement() {
        const attributes = new Map<string, string>();
        const element = {
          attributes,
          className: "",
          style: { display: "" },
          setAttribute(name: string, value: string) {
            attributes.set(name, value);
          },
          getAttribute(name: string) {
            return attributes.get(name) ?? null;
          },
          appendChild() {},
        };
        created.push(element);
        return element;
      },
      body: { appendChild() {} },
    } as unknown as Document;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: fakeDocument,
    });

    const overlay = createOverlay("hover");

    assertEquals(overlay.getAttribute("data-vf-ignore"), "true");
    assertEquals(overlay.getAttribute("data-html2canvas-ignore"), "true");
    assertEquals(created.length, 2);
  });

  it("finds an exact node identifier without interpolating it into a selector", () => {
    const nodeId = `node\"] *, [data-secret=\"value`;
    const queriedSelectors: string[] = [];
    const element = {
      getAttribute(name: string) {
        return name === "data-vf-id" ? nodeId : null;
      },
    } as unknown as Element;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        getElementsByTagName(selector: string) {
          queriedSelectors.push(selector);
          return selector === "*" ? [element] : [];
        },
      },
    });
    assertEquals(findElementById(nodeId), element);
    assertEquals(queriedSelectors, ["*"]);
  });

  it("does not scan collections after exact selectors report a miss", () => {
    let exactQueries = 0;
    let collectionQueries = 0;
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: { escape: (value: string) => value },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        querySelector() {
          exactQueries++;
          return null;
        },
        querySelectorAll() {
          collectionQueries++;
          return [];
        },
      },
    });

    assertEquals(findElementById("missing"), null);
    assertEquals(exactQueries, 3);
    assertEquals(collectionQueries, 0);
  });

  it("bounds identifier fallback reads across every attribute", () => {
    let collectionReads = 0;
    const missing = {
      getAttribute() {
        return null;
      },
    } as unknown as Element;
    const oversizedCollection = {
      length: 25_000,
      item() {
        collectionReads++;
        return missing;
      },
      [Symbol.iterator]() {
        return {
          next() {
            throw new Error("identifier fallback must not use an unbounded iterator");
          },
        };
      },
    };
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        getElementsByTagName() {
          return oversizedCollection;
        },
        querySelectorAll() {
          throw new Error("the bounded all-elements collection is available");
        },
      },
    });

    assertEquals(findElementById("missing"), null);
    assertEquals(collectionReads <= 10_000, true);
  });

  it("scrolls only the exact matching selector identifier", () => {
    let scrollCalls = 0;
    const exact = {
      getAttribute(name: string) {
        return name === "data-vf-selector" ? "node-10" : null;
      },
      scrollIntoView() {
        scrollCalls++;
      },
    } as unknown as Element;
    const partial = {
      getAttribute(name: string) {
        return name === "data-vf-selector" ? "prefix-node-10-suffix" : null;
      },
      scrollIntoView() {
        throw new Error("partial match must not scroll");
      },
    } as unknown as Element;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        getElementsByTagName(selector: string) {
          return selector === "*" ? [partial, exact] : [];
        },
      },
    });

    scrollToElement("node-10");

    assertEquals(scrollCalls, 1);
  });

  it("accepts only supported color modes", () => {
    const attributes = new Map<string, string>();
    const classes = new Set<string>();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        documentElement: {
          setAttribute(name: string, value: string) {
            attributes.set(name, value);
          },
          classList: {
            remove(...values: string[]) {
              for (const value of values) classes.delete(value);
            },
            add(value: string) {
              classes.add(value);
            },
          },
        },
      },
    });

    assertEquals(setColorMode("dark"), true);
    assertEquals(setColorMode("sepia"), false);
    assertEquals(attributes.get("data-theme"), "dark");
    assertEquals([...classes], ["dark"]);
  });

  it("bounds deeply nested navigator trees", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    setConfigForTest({ pagePath: "page.mdx" });

    function createElement(tagName: string, children: unknown[] = []): Element {
      const attributes = new Map<string, string>();
      return {
        nodeType: 1,
        tagName,
        children,
        childNodes: children,
        style: { display: "" },
        textContent: "",
        hasAttribute(name: string) {
          return attributes.has(name);
        },
        getAttribute(name: string) {
          return attributes.get(name) ?? null;
        },
        setAttribute(name: string, value: string) {
          attributes.set(name, value);
        },
      } as unknown as Element;
    }

    let nested = createElement("SPAN");
    for (let depth = 0; depth < 100; depth++) nested = createElement("DIV", [nested]);
    const tree = buildNavigatorTree(createElement("MAIN", [nested]));

    let depth = 0;
    let current = tree.children[0];
    while (current) {
      depth++;
      current = current.children[0];
    }
    assertEquals(depth <= 65, true);
  });

  it("bounds navigator text to the renderer schema contract", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    setConfigForTest({ pagePath: "page.mdx" });
    const attributes = new Map([["data-vf-text", "true"]]);
    const textElement = {
      nodeType: 1,
      tagName: "P",
      children: [],
      childNodes: [{ nodeType: 3, textContent: `  ${"x".repeat(201)}  ` }],
      style: { display: "" },
      textContent: `  ${"x".repeat(201)}  `,
      hasAttribute(name: string) {
        return attributes.has(name);
      },
      getAttribute(name: string) {
        return attributes.get(name) ?? null;
      },
      setAttribute(name: string, value: string) {
        attributes.set(name, value);
      },
    } as unknown as Element;
    const root = { children: [textElement] } as unknown as Element;

    assertEquals(buildNavigatorTree(root).children[0]?.text?.length, 200);
  });

  it("excludes ignored descendant text from navigator payloads", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    setConfigForTest({ pagePath: "page.mdx" });
    const visibleText = { nodeType: 3, textContent: "Visible" };
    const privateText = { nodeType: 3, textContent: "private-value" };
    const ignored = createInspectorElement(
      "SPAN",
      [],
      { "data-vf-ignore": "true" },
      [privateText],
    );
    const textElement = createInspectorElement(
      "P",
      [ignored],
      { "data-vf-text": "true" },
      [visibleText, ignored as unknown as { nodeType: number; textContent: string | null }],
    );

    const tree = buildNavigatorTree(createInspectorElement("MAIN", [textElement]));

    assertEquals(tree.children[0]?.text, "Visible");
  });

  it("prunes ignored subtrees from the navigator", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    setConfigForTest({ pagePath: "page.mdx" });
    const child = createInspectorElement("SPAN");
    const ignored = createInspectorElement("SECTION", [child], { "data-vf-ignore": "true" });

    const tree = buildNavigatorTree({ children: [ignored] } as unknown as Element);

    assertEquals(tree.children, []);
  });

  it("prunes ignored subtrees before spending the navigator scan budget", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    setConfigForTest({ pagePath: "page.mdx" });
    const ignoredLeaf = createInspectorElement("SPAN");
    const ignored = createInspectorElement("SECTION", [], { "data-vf-ignore": "true" });
    let ignoredChildReads = 0;
    Object.defineProperty(ignored, "children", {
      value: {
        length: 25_000,
        item() {
          ignoredChildReads++;
          return ignoredLeaf;
        },
      },
    });
    const generated = createInspectorElement("DIV");
    const reserved = createInspectorElement("P", [], {
      "data-vf-selector": "vf-div-1",
    });
    const visible = createInspectorElement("ARTICLE", [generated, reserved]);

    const tree = buildNavigatorTree(createInspectorElement("MAIN", [ignored, visible]));

    assertEquals(ignoredChildReads, 0);
    assertEquals(tree.children.length, 1);
    assertEquals(tree.children[0]?.children.map((node) => node.id), ["vf-div-2", "vf-div-1"]);
  });

  it("bounds selected-node attributes, positions, and direct text", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    setConfigForTest({ pagePath: "page.mdx" });
    const element = createInspectorElement("DIV", [], {
      "data-node-name": "n".repeat(300),
      "data-node-file": "f".repeat(5_000),
      "data-node-line": "999999999999",
      "data-node-column": "12",
    }, [
      { nodeType: 3, textContent: "x".repeat(500) },
    ]);

    assertEquals(buildSelectedNodeDetails(element), {
      name: "div",
      type: "element",
      file: "page.mdx",
      line: 0,
      column: 12,
      text: "x".repeat(200),
    });
  });

  it("preserves valid project-relative selected-node source paths", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    setConfigForTest({ pagePath: "pages/fallback.mdx" });

    for (
      const file of [
        "app/page.tsx",
        "docs/guides/intro file.mdx",
        "docs/日本語/e\u0301tude.mdx",
        "components/😀-按钮.tsx",
      ]
    ) {
      const element = createInspectorElement("DIV", [], {
        "data-node-file": file,
      });

      assertEquals(buildSelectedNodeDetails(element).file, file);
    }
  });

  it("does not expose unsafe selected-node source paths", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    setConfigForTest({ pagePath: "pages/fallback.mdx" });

    for (
      const file of [
        "/private/workspace/secret.tsx",
        "C:/Users/example/project/page.tsx",
        String.raw`C:\Users\example\project\page.tsx`,
        String.raw`\\server\share\page.tsx`,
        "//server/share/page.tsx",
        "../private/page.tsx",
        "app/../../private/page.tsx",
        "app/%2e%2e/private/page.tsx",
        "app/%252e%252e/private/page.tsx",
        "%2fprivate/workspace/page.tsx",
        "app/%00private/page.tsx",
        "file:///private/workspace/page.tsx",
        "file%3A%2F%2F%2Fprivate/workspace/page.tsx",
        "https://example.test/page.tsx",
        "webpack://project/app/page.tsx",
        "~/private/workspace/page.tsx",
        "app/page.tsx\0/private",
        "app/page.tsx?token=<TOKEN>#private",
        "app/%255cprivate/page.tsx",
        "app/source\u061cts",
        "app/source\u2028ts",
        "app/source\ud800ts",
        "app／private/page.tsx",
        String.raw`app＼private/page.tsx`,
        "．．/private/page.tsx",
        "%EF%BC%8E%EF%BC%8E/private/page.tsx",
        "ｆｉｌｅ：／／／private/workspace/page.tsx",
        "ｈｔｔｐｓ：／／example.test/page.tsx",
        String.raw`Ｃ：＼Users＼example＼project＼page.tsx`,
      ]
    ) {
      const element = createInspectorElement("DIV", [], {
        "data-node-file": file,
      });

      assertEquals(buildSelectedNodeDetails(element).file, "pages/fallback.mdx");
    }
  });

  it("uses an empty selected-node source path when every candidate is unsafe", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    setConfigForTest({ pagePath: "/private/workspace/fallback.mdx" });
    const element = createInspectorElement("DIV", [], {
      "data-node-file": "file:///private/workspace/page.tsx",
    });

    assertEquals(buildSelectedNodeDetails(element).file, "");
  });

  it("does not expose an unsafe configured path in navigator nodes", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    setConfigForTest({ pagePath: String.raw`C:\Users\example\project\page.tsx` });
    const child = createInspectorElement("DIV");

    assertEquals(buildNavigatorTree(createInspectorElement("MAIN", [child])).children[0]?.path, "");
  });

  it("stops traversing oversized DOM collections at the navigator budgets", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    setConfigForTest({ pagePath: "page.mdx" });
    let rootReads = 0;
    const invalidElement = { nodeType: 0 } as unknown as Element;
    const oversizedChildren = {
      length: 25_000,
      item() {
        rootReads++;
        return invalidElement;
      },
      *[Symbol.iterator]() {
        for (let index = 0; index < 25_000; index++) {
          rootReads++;
          yield invalidElement;
        }
      },
    } as unknown as HTMLCollection;

    buildNavigatorTree({ children: oversizedChildren } as unknown as Element);

    assertEquals(rootReads <= 10_000, true);

    let textReads = 0;
    const textNode = { nodeType: 3, textContent: "x" } as Node;
    const oversizedTextNodes = {
      length: 25_000,
      item() {
        textReads++;
        return textNode;
      },
      *[Symbol.iterator]() {
        for (let index = 0; index < 25_000; index++) {
          textReads++;
          yield textNode;
        }
      },
    } as unknown as NodeListOf<ChildNode>;
    const textElement = createInspectorElement("P", [], { "data-vf-text": "true" });
    Object.defineProperty(textElement, "childNodes", { value: oversizedTextNodes });
    const textTree = buildNavigatorTree({ children: [textElement] } as unknown as Element);

    assertEquals(textReads <= 10_000, true);
    assertEquals(textTree.children[0]?.text?.length, 200);
  });

  it("does not generate an identifier reserved by a later DOM element", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    setConfigForTest({ pagePath: "page.mdx" });
    const generated = createInspectorElement("DIV");
    const existing = createInspectorElement("P", [], {
      "data-vf-selector": "vf-div-1",
    });

    const tree = buildNavigatorTree({
      children: [generated, existing],
      getAttribute() {
        return null;
      },
    } as unknown as Element);

    assertEquals(tree.children[0]?.id, "vf-div-2");
    assertEquals(tree.children[1]?.id, "vf-div-1");
  });

  it("assigns resolvable session identifiers after insertion and remount", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    setConfigForTest({ pagePath: "page.mdx" });
    const first = createInspectorElement("MAIN");
    const rootChildren = [first];
    const root = createInspectorElement("DIV", rootChildren, { id: "root" });

    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        querySelectorAll(selector: string) {
          const attribute = /^\[([^\]]+)\]$/.exec(selector)?.[1];
          return attribute ? rootChildren.filter((element) => element.hasAttribute(attribute)) : [];
        },
      },
    });

    let tree = buildNavigatorTree(root);
    assertEquals(findElementById(tree.children[0]!.id), first);

    const inserted = createInspectorElement("MAIN");
    rootChildren.push(inserted);
    tree = buildNavigatorTree(root);
    assertEquals(tree.children[0]!.id === tree.children[1]!.id, false);
    assertEquals(findElementById(tree.children[0]!.id), first);
    assertEquals(findElementById(tree.children[1]!.id), inserted);

    const remounted = createInspectorElement("MAIN");
    rootChildren.splice(0, 1, remounted);
    tree = buildNavigatorTree(root);
    assertEquals(findElementById(tree.children[0]!.id), remounted);
    assertEquals(findElementById(tree.children[1]!.id), inserted);
  });

  it("removes only bridge-created selector attributes during disposal", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    setConfigForTest({ pagePath: "page.mdx" });
    const generated = createInspectorElement("DIV");
    const replaced = createInspectorElement("SPAN");
    const appOwned = createInspectorElement("P", [], {
      "data-vf-selector": "app-selector",
    });

    buildNavigatorTree(createInspectorElement("MAIN", [generated, replaced, appOwned]));
    assertEquals(generated.getAttribute("data-vf-selector")?.startsWith("vf-div-"), true);
    replaced.setAttribute("data-vf-selector", "app-replaced-selector");

    disposeInspector();

    assertEquals(generated.getAttribute("data-vf-selector"), null);
    assertEquals(replaced.getAttribute("data-vf-selector"), "app-replaced-selector");
    assertEquals(appOwned.getAttribute("data-vf-selector"), "app-selector");
  });

  it("preserves authored selector collisions and stable in-memory canonical IDs", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    setConfigForTest({ pagePath: "page.mdx" });
    const first = createInspectorElement("DIV", [], {
      "data-vf-selector": "shared-selector",
    });
    const second = createInspectorElement("SPAN", [], {
      "data-vf-selector": "shared-selector",
    });
    const reserved = createInspectorElement("SECTION", [], {
      "data-vf-selector": "root",
    });
    const children = [first, second, reserved];
    const root = createInspectorElement("MAIN", children);

    const initialIds = buildNavigatorTree(root).children.map((node) => node.id);
    assertEquals(first.getAttribute("data-vf-selector"), "shared-selector");
    assertEquals(second.getAttribute("data-vf-selector"), "shared-selector");
    assertEquals(reserved.getAttribute("data-vf-selector"), "root");
    assertEquals(new Set(initialIds).size, 3);
    assertEquals(initialIds.includes("root"), false);

    children.reverse();
    const reorderedIds = buildNavigatorTree(root).children.map((node) => node.id);
    assertEquals(reorderedIds, [initialIds[2], initialIds[1], initialIds[0]]);

    disposeInspector();
    assertEquals(first.getAttribute("data-vf-selector"), "shared-selector");
    assertEquals(second.getAttribute("data-vf-selector"), "shared-selector");
    assertEquals(reserved.getAttribute("data-vf-selector"), "root");
  });

  it("reconciles bridge-created selectors after app changes and repeated DOM churn", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    setConfigForTest({ pagePath: "page.mdx" });
    const children: Element[] = [];
    const root = createInspectorElement("MAIN", children);
    const externallyRemoved = createInspectorElement("DIV");
    children.push(externallyRemoved);

    const originalId = buildNavigatorTree(root).children[0]!.id;
    assertEquals(_bridgeCreatedSelectorCountForTest(), 1);
    externallyRemoved.removeAttribute("data-vf-selector");

    const rebuiltId = buildNavigatorTree(root).children[0]!.id;
    assertEquals(rebuiltId, originalId);
    assertEquals(externallyRemoved.getAttribute("data-vf-selector"), null);
    assertEquals(_bridgeCreatedSelectorCountForTest(), 0);

    let previous: Element | null = externallyRemoved;
    for (let index = 0; index < 12; index++) {
      const current = createInspectorElement("DIV");
      children.splice(0, 1, current);
      buildNavigatorTree(root);

      assertEquals(previous.getAttribute("data-vf-selector"), null);
      assertEquals(current.getAttribute("data-vf-selector")?.startsWith("vf-div-"), true);
      assertEquals(_bridgeCreatedSelectorCountForTest(), 1);
      previous = current;
    }

    children.length = 0;
    buildNavigatorTree(root);
    assertEquals(previous?.getAttribute("data-vf-selector"), null);
    assertEquals(_bridgeCreatedSelectorCountForTest(), 0);
  });

  it("assigns unique schema-valid identifiers and names across attribute collisions", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    setConfigForTest({ pagePath: "page.mdx" });
    const first = createInspectorElement("DIV", [], { "data-vf-id": "duplicate" });
    const second = createInspectorElement("SPAN", [], { "data-node-id": "duplicate" });
    const rootCollision = createInspectorElement("SECTION", [], { "data-vf-id": "root" });
    const emptyName = createInspectorElement("ARTICLE", [], { "data-vf-id": "_private" });
    const longTag = createInspectorElement("X".repeat(800));
    const elements = [first, second, rootCollision, emptyName, longTag];
    const tree = buildNavigatorTree(createInspectorElement("MAIN", elements));

    const ids = tree.children.map((node) => node.id);
    assertEquals(new Set(ids).size, elements.length);
    assertEquals(ids.includes("root"), false);
    assertEquals(tree.children.every((node) => node.id.length <= 512), true);
    assertEquals(
      tree.children.every((node) => node.name.length >= 1 && node.name.length <= 256),
      true,
    );
    for (let index = 0; index < ids.length; index++) {
      assertEquals(findElementById(ids[index]!), elements[index]);
    }

    const rebuiltIds = buildNavigatorTree(createInspectorElement("MAIN", elements)).children.map(
      (node) => node.id,
    );
    assertEquals(rebuiltIds, ids);
  });

  it("keeps duplicate source identifiers bound to the same elements after reorder", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    setConfigForTest({ pagePath: "page.mdx" });
    const first = createInspectorElement("DIV", [], { "data-node-id": "node-1" });
    const second = createInspectorElement("SPAN", [], { "data-node-id": "node-1" });
    const children = [first, second];
    const root = createInspectorElement("MAIN", children);

    const initial = buildNavigatorTree(root).children;
    const firstId = initial[0]!.id;
    const secondId = initial[1]!.id;
    assertEquals(firstId === secondId, false);

    children.reverse();
    const reordered = buildNavigatorTree(root).children;

    assertEquals(reordered.map((node) => node.id), [secondId, firstId]);
    assertEquals(findElementById(firstId), first);
    assertEquals(findElementById(secondId), second);
  });

  it("observes every attribute that contributes to navigator output", () => {
    let observerOptions: MutationObserverInit | undefined;
    let observedTarget: Node | undefined;
    let observerCallback: MutationCallback | undefined;
    let takeRecordsCalls = 0;
    class FakeMutationObserver {
      constructor(callback: MutationCallback) {
        observerCallback = callback;
      }
      observe(target: Node, options: MutationObserverInit) {
        observedTarget = target;
        observerOptions = options;
      }
      takeRecords() {
        takeRecordsCalls++;
        return [];
      }
      disconnect() {}
    }
    const root = createInspectorElement("MAIN");
    const body = createInspectorElement("BODY", [root]);
    const documentElement = createInspectorElement("HTML", [body]);
    Object.defineProperty(globalThis, "MutationObserver", {
      configurable: true,
      value: FakeMutationObserver,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        body,
        documentElement,
        getElementById() {
          return root;
        },
      },
    });
    const fakeWindow = { location: { href: "https://preview.example/page" } } as Window;
    Object.defineProperty(fakeWindow, "parent", { value: fakeWindow });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
    });
    setConfigForTest({ pagePath: "page.mdx", pageId: "page-1" });

    setupMutationObserver();

    assertEquals(observerOptions?.attributes, true);
    assertEquals(observerOptions?.characterData, true);
    assertEquals(observerOptions?.subtree, true);
    assertEquals(observerOptions?.attributeFilter?.includes("id"), true);
    assertEquals(observerOptions?.attributeFilter?.includes("data-vf-text"), true);
    assertEquals(observerOptions?.attributeFilter?.includes("data-node-file"), true);
    assertEquals(observedTarget, documentElement);
    assertEquals(takeRecordsCalls, 0);

    const ignored = createInspectorElement("DIV", [], { "data-vf-ignore": "true" });
    Object.defineProperty(ignored, "parentElement", { value: body });
    const ignoredContent = createInspectorElement("DIV", [], { "data-vf-ignore": "true" });
    Object.defineProperty(ignoredContent, "parentElement", { value: root });
    let scheduledUpdates = 0;
    const originalSetTimeout = globalThis.setTimeout;
    Object.defineProperty(globalThis, "setTimeout", {
      configurable: true,
      value: (() => {
        scheduledUpdates++;
        return 1;
      }) as typeof setTimeout,
    });
    try {
      observerCallback?.([
        {
          type: "attributes",
          attributeName: "style",
          target: ignored,
        } as unknown as MutationRecord,
        {
          type: "childList",
          target: body,
          addedNodes: [ignored],
          removedNodes: [],
        } as unknown as MutationRecord,
      ], {} as MutationObserver);
      assertEquals(scheduledUpdates, 0);

      observerCallback?.([
        {
          type: "attributes",
          attributeName: "data-vf-ignore",
          target: ignoredContent,
        } as unknown as MutationRecord,
      ], {} as MutationObserver);
      assertEquals(scheduledUpdates, 2);

      observerCallback?.([
        { type: "attributes", attributeName: "style", target: body } as unknown as MutationRecord,
      ], {} as MutationObserver);
      assertEquals(scheduledUpdates, 2);

      const unrelatedIdTarget = createInspectorElement("DIV");
      Object.defineProperty(unrelatedIdTarget, "parentElement", { value: root });
      observerCallback?.([
        {
          type: "attributes",
          attributeName: "id",
          target: unrelatedIdTarget,
        } as unknown as MutationRecord,
      ], {} as MutationObserver);
      assertEquals(scheduledUpdates, 2);

      observerCallback?.([
        { type: "attributes", attributeName: "style", target: root } as unknown as MutationRecord,
      ], {} as MutationObserver);
      assertEquals(scheduledUpdates, 3);

      const relevant = createInspectorElement("SPAN");
      Object.defineProperty(relevant, "parentElement", { value: root });
      const oversizedNodes = {
        length: 10_001,
        item(index: number) {
          return index === 10_000 ? relevant : ignoredContent;
        },
      } as unknown as NodeList;
      observerCallback?.([
        {
          type: "childList",
          target: root,
          addedNodes: oversizedNodes,
          removedNodes: [],
        } as unknown as MutationRecord,
      ], {} as MutationObserver);
      assertEquals(scheduledUpdates, 4);
    } finally {
      Object.defineProperty(globalThis, "setTimeout", {
        value: originalSetTimeout,
        configurable: true,
      });
    }
  });

  it("rebuilds when an element acquires or loses the navigator root id", () => {
    let observerCallback: MutationCallback | undefined;
    class FakeMutationObserver {
      constructor(callback: MutationCallback) {
        observerCallback = callback;
      }
      observe() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    Object.defineProperty(globalThis, "MutationObserver", {
      configurable: true,
      value: FakeMutationObserver,
    });
    const candidate = createInspectorElement("MAIN");
    const body = createInspectorElement("BODY", [candidate]);
    Object.defineProperty(candidate, "parentElement", { value: body });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        body,
        getElementById() {
          return candidate.getAttribute("id") === "root" ? candidate : null;
        },
      },
    });
    const fakeWindow = { location: { href: "https://preview.example/page" } } as Window;
    Object.defineProperty(fakeWindow, "parent", { value: fakeWindow });
    Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
    setConfigForTest({ pagePath: "page.mdx", pageId: "page-1" });

    const scheduledCallbacks: Array<() => void> = [];
    const originalSetTimeout = globalThis.setTimeout;
    Object.defineProperty(globalThis, "setTimeout", {
      configurable: true,
      value: ((callback: () => void) => {
        scheduledCallbacks.push(callback);
        return scheduledCallbacks.length;
      }) as typeof setTimeout,
    });
    try {
      setupMutationObserver();

      candidate.setAttribute("id", "root");
      observerCallback?.([
        { type: "attributes", attributeName: "id", target: candidate } as unknown as MutationRecord,
      ], {} as MutationObserver);
      assertEquals(scheduledCallbacks.length, 2);

      scheduledCallbacks.shift()?.();
      candidate.setAttribute("id", "other");
      observerCallback?.([
        { type: "attributes", attributeName: "id", target: candidate } as unknown as MutationRecord,
      ], {} as MutationObserver);
      assertEquals(scheduledCallbacks.length, 3);
    } finally {
      Object.defineProperty(globalThis, "setTimeout", {
        value: originalSetTimeout,
        configurable: true,
      });
    }
  });

  it("keeps observing after the document body is replaced", () => {
    let observerCallback: MutationCallback | undefined;
    let observedTarget: Node | undefined;
    class FakeMutationObserver {
      constructor(callback: MutationCallback) {
        observerCallback = callback;
      }
      observe(target: Node) {
        observedTarget = target;
      }
      disconnect() {}
    }
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    Object.defineProperty(globalThis, "MutationObserver", {
      configurable: true,
      value: FakeMutationObserver,
    });
    let body = createInspectorElement("BODY");
    const documentElement = createInspectorElement("HTML", [body]);
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        get body() {
          return body;
        },
        documentElement,
        getElementById() {
          return null;
        },
      },
    });
    const fakeWindow = { location: { href: "https://preview.example/page" } } as Window;
    Object.defineProperty(fakeWindow, "parent", { value: fakeWindow });
    Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
    setConfigForTest({ pagePath: "page.mdx", pageId: "page-1" });

    const scheduledCallbacks: Array<() => void> = [];
    const originalSetTimeout = globalThis.setTimeout;
    Object.defineProperty(globalThis, "setTimeout", {
      configurable: true,
      value: ((callback: () => void) => {
        scheduledCallbacks.push(callback);
        return scheduledCallbacks.length;
      }) as typeof setTimeout,
    });
    try {
      setupMutationObserver();
      assertEquals(observedTarget, documentElement);

      const previousBody = body;
      body = createInspectorElement("BODY");
      observerCallback?.([
        {
          type: "childList",
          target: documentElement,
          addedNodes: [body],
          removedNodes: [previousBody],
        } as unknown as MutationRecord,
      ], {} as MutationObserver);

      assertEquals(scheduledCallbacks.length, 2);
    } finally {
      Object.defineProperty(globalThis, "setTimeout", {
        value: originalSetTimeout,
        configurable: true,
      });
    }
  });

  it("publishes navigator state during sustained relevant mutations", () => {
    using time = new FakeTime();
    let observerCallback: MutationCallback | undefined;
    class FakeMutationObserver {
      constructor(callback: MutationCallback) {
        observerCallback = callback;
      }
      observe() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    Object.defineProperty(globalThis, "MutationObserver", {
      configurable: true,
      value: FakeMutationObserver,
    });
    let childReads = 0;
    const root = createInspectorElement("MAIN");
    Object.defineProperty(root, "children", {
      configurable: true,
      get() {
        childReads++;
        return [];
      },
    });
    const body = createInspectorElement("BODY", [root]);
    Object.defineProperty(root, "parentElement", { value: body });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        body,
        documentElement: body,
        getElementById() {
          return root;
        },
      },
    });
    const fakeWindow = { location: { href: "https://preview.example/page" } } as Window;
    Object.defineProperty(fakeWindow, "parent", { value: fakeWindow });
    Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
    setConfigForTest({ pagePath: "page.mdx", pageId: "page-1" });

    setupMutationObserver();
    const initialReads = childReads;
    for (let index = 0; index < 12; index++) {
      observerCallback?.([
        {
          type: "attributes",
          attributeName: "style",
          target: root,
        } as unknown as MutationRecord,
      ], {} as MutationObserver);
      time.tick(100);
    }

    assertEquals(childReads > initialReads, true);
    disposeInspector();
  });

  it("clears selection after a selected element changes navigator identity", async () => {
    let observerCallback: MutationCallback | undefined;
    class FakeMutationObserver {
      constructor(callback: MutationCallback) {
        observerCallback = callback;
      }
      observe() {}
      takeRecords() {
        return [];
      }
      disconnect() {}
    }
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    Object.defineProperty(globalThis, "MutationObserver", {
      configurable: true,
      value: FakeMutationObserver,
    });
    const selected = createInspectorElement("DIV", [], { "data-vf-id": "old-id" });
    const root = createInspectorElement("MAIN", [selected]);
    const body = createInspectorElement("BODY", [root]);
    Object.defineProperty(selected, "parentElement", { value: root });
    Object.defineProperty(root, "parentElement", { value: body });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        body,
        getElementById() {
          return root;
        },
        getElementsByTagName() {
          return [selected];
        },
      },
    });
    const fakeWindow = { location: { href: "https://preview.example/page" } } as Window;
    Object.defineProperty(fakeWindow, "parent", { value: fakeWindow });
    Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
    setConfigForTest({ pagePath: "page.mdx", pageId: "page-1" });

    setupMutationObserver();
    state.selectedNodeId = "old-id";
    state.hoveredNodeId = "old-id";
    state.selectionOverlay = { style: { display: "block" } } as unknown as HTMLElement;
    state.hoverOverlay = { style: { display: "block" } } as unknown as HTMLElement;
    selected.setAttribute("data-vf-id", "new-id");
    observerCallback?.([
      {
        type: "attributes",
        attributeName: "data-vf-id",
        target: selected,
      } as unknown as MutationRecord,
    ], {} as MutationObserver);
    await new Promise((resolve) => setTimeout(resolve, 175));

    assertEquals(state.selectedNodeId, null);
    assertEquals(state.hoveredNodeId, null);
    assertEquals(state.selectionOverlay.style.display, "none");
    assertEquals(state.hoverOverlay.style.display, "none");
  });

  it("repositions overlays after a same-identity DOM remount", async () => {
    let observerCallback: MutationCallback | undefined;
    class FakeMutationObserver {
      constructor(callback: MutationCallback) {
        observerCallback = callback;
      }
      observe() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    Object.defineProperty(globalThis, "MutationObserver", {
      configurable: true,
      value: FakeMutationObserver,
    });
    const first = createInspectorElement("DIV", [], { "data-vf-id": "same-id" });
    const remounted = createInspectorElement("DIV", [], { "data-vf-id": "same-id" });
    Object.defineProperty(first, "getBoundingClientRect", {
      value: () => ({ top: 1, left: 2, width: 3, height: 4 }),
    });
    Object.defineProperty(remounted, "getBoundingClientRect", {
      value: () => ({ top: 41, left: 42, width: 43, height: 44 }),
    });
    const rootChildren = [first];
    const root = createInspectorElement("MAIN", rootChildren);
    const body = createInspectorElement("BODY", [root]);
    Object.defineProperty(first, "parentElement", { value: root });
    Object.defineProperty(remounted, "parentElement", { value: root });
    Object.defineProperty(root, "parentElement", { value: body });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        body,
        getElementById() {
          return root;
        },
      },
    });
    const fakeWindow = { location: { href: "https://preview.example/page" } } as Window;
    Object.defineProperty(fakeWindow, "parent", { value: fakeWindow });
    Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
    setConfigForTest({ pagePath: "page.mdx", pageId: "page-1" });
    const makeOverlay = () =>
      ({
        style: { display: "none", top: "" },
        querySelector: () => null,
      }) as unknown as HTMLElement;

    setupMutationObserver();
    state.selectedNodeId = "same-id";
    state.hoveredNodeId = "same-id";
    state.selectionOverlay = makeOverlay();
    state.hoverOverlay = makeOverlay();
    rootChildren.splice(0, 1, remounted);
    observerCallback?.([
      {
        type: "childList",
        target: root,
        addedNodes: [remounted],
        removedNodes: [first],
      } as unknown as MutationRecord,
    ], {} as MutationObserver);
    await new Promise((resolve) => setTimeout(resolve, 175));

    assertEquals(state.selectionOverlay.style.top, "41px");
    assertEquals(state.hoverOverlay.style.top, "41px");
  });

  it("releases navigator element references during inspector disposal", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    setConfigForTest({ pagePath: "page.mdx" });
    const element = createInspectorElement("DIV");
    const id = buildNavigatorTree(createInspectorElement("MAIN", [element])).children[0]!.id;
    assertEquals(findElementById(id), element);

    disposeInspector();
    Object.defineProperty(globalThis, "CSS", { configurable: true, value: undefined });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { getElementsByTagName: () => [] },
    });

    assertEquals(findElementById(id), null);
  });

  it("initializes inspect listeners once and ignores non-element event targets", () => {
    const originalWindow = globalThis.window;
    const listeners = new Map<string, EventListener[]>();
    const fakeWindow = {
      parent: null as unknown,
      addEventListener() {},
      removeEventListener() {},
    };
    fakeWindow.parent = fakeWindow;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        addEventListener(type: string, listener: EventListener) {
          const registered = listeners.get(type) ?? [];
          registered.push(listener);
          listeners.set(type, registered);
        },
        removeEventListener() {},
      },
    });
    state.inspectMode = true;
    try {
      setupInspectMode();
      setupInspectMode();

      assertEquals(listeners.get("click")?.length, 1);
      listeners.get("click")?.[0]?.({
        target: { nodeType: 3 },
        preventDefault() {},
        stopPropagation() {},
      } as unknown as Event);
      listeners.get("pointerover")?.[0]?.({
        target: { nodeType: 3 },
        pointerType: "mouse",
      } as unknown as Event);
    } finally {
      state.inspectMode = false;
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it("throttles sustained overlay updates to animation frames", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    const listeners = new Map<string, EventListener>();
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    let geometryReads = 0;
    const selected = createInspectorElement("DIV", [], { "data-vf-id": "selected" });
    Object.defineProperty(selected, "getBoundingClientRect", {
      value: () => {
        geometryReads++;
        return { top: 1, left: 2, width: 3, height: 4 };
      },
    });
    const root = createInspectorElement("MAIN", [selected]);
    const body = createInspectorElement("BODY", [root]);
    Object.defineProperty(selected, "parentElement", { value: root });
    Object.defineProperty(root, "parentElement", { value: body });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        body,
        getElementById() {
          return root;
        },
        addEventListener() {},
        removeEventListener() {},
      },
    });
    const fakeWindow = {
      parent: null as unknown,
      addEventListener(type: string, listener: EventListener) {
        listeners.set(type, listener);
      },
      removeEventListener(type: string) {
        listeners.delete(type);
      },
      requestAnimationFrame(callback: FrameRequestCallback) {
        const id = ++frameId;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame(id: number) {
        frames.delete(id);
      },
    };
    fakeWindow.parent = fakeWindow;
    Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
    setConfigForTest({ pagePath: "page.mdx" });
    buildNavigatorTree(root);
    state.selectedNodeId = "selected";
    state.selectionOverlay = {
      style: { display: "none" },
      querySelector: () => null,
    } as unknown as HTMLElement;

    setupInspectMode();
    for (let event = 0; event < 100; event++) listeners.get("scroll")?.({} as Event);
    assertEquals(frames.size, 1);

    const [firstFrameId, firstFrame] = frames.entries().next().value!;
    frames.delete(firstFrameId);
    firstFrame(0);
    assertEquals(geometryReads, 1);

    for (let event = 0; event < 100; event++) listeners.get("scroll")?.({} as Event);
    assertEquals(frames.size, 1);
    disposeInspector();
    assertEquals(frames.size, 0);
  });

  it("selects only mapped elements inside the navigator root and outside ignored subtrees", () => {
    Object.defineProperty(globalThis, "Node", {
      configurable: true,
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    });
    const listeners = new Map<string, EventListener[]>();
    const valid = createInspectorElement("DIV", [], { "data-vf-id": "valid" });
    const ignored = createInspectorElement("SECTION", [], { "data-vf-ignore": "true" });
    const ignoredChild = createInspectorElement("SPAN", [], { "data-vf-id": "ignored" });
    const outside = createInspectorElement("ASIDE", [], { "data-vf-id": "outside" });
    const root = createInspectorElement("MAIN", [valid, ignored]);
    const body = createInspectorElement("BODY", [root, outside]);
    Object.defineProperty(valid, "parentElement", { value: root });
    Object.defineProperty(ignored, "parentElement", { value: root });
    Object.defineProperty(ignoredChild, "parentElement", { value: ignored });
    Object.defineProperty(outside, "parentElement", { value: body });
    for (const element of [valid, ignoredChild, outside]) {
      Object.defineProperty(element, "closest", { value: () => element });
    }
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        body,
        addEventListener(type: string, listener: EventListener) {
          const registered = listeners.get(type) ?? [];
          registered.push(listener);
          listeners.set(type, registered);
        },
        removeEventListener() {},
      },
    });
    const fakeWindow = {
      parent: null as unknown,
      addEventListener() {},
      removeEventListener() {},
    };
    fakeWindow.parent = fakeWindow;
    Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
    setConfigForTest({ pagePath: "page.mdx" });
    buildNavigatorTree(root);
    state.inspectMode = true;
    setupInspectMode();

    const click = listeners.get("click")?.[0];
    const eventFor = (target: Element) =>
      ({ target, preventDefault() {}, stopPropagation() {} }) as unknown as Event;

    click?.(eventFor(ignoredChild));
    assertEquals(state.selectedNodeId, null);
    click?.(eventFor(outside));
    assertEquals(state.selectedNodeId, null);
    click?.(eventFor(valid));
    assertEquals(state.selectedNodeId, "valid");
  });
});

function createInspectorElement(
  tagName: string,
  children: Element[] = [],
  initialAttributes: Record<string, string> = {},
  childNodes: Array<{ nodeType: number; textContent: string | null }> =
    children as unknown as Array<{
      nodeType: number;
      textContent: string | null;
    }>,
): Element {
  const attributes = new Map(Object.entries(initialAttributes));
  return {
    nodeType: 1,
    tagName,
    children,
    childNodes,
    style: { display: "" },
    textContent: childNodes.map((node) => node.textContent ?? "").join(""),
    hasAttribute(name: string) {
      return attributes.has(name);
    },
    getAttribute(name: string) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    removeAttribute(name: string) {
      attributes.delete(name);
    },
  } as unknown as Element;
}
