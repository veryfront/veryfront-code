import * as React from "react";
import type { ClientComponentMeta, RSCNode } from "../types.ts";
import { escapeHtml } from "#veryfront/html/html-escape.ts";
import { renderToStaticMarkupAdapter } from "#veryfront/react/compat/ssr-adapter/index.ts";
import { encodeClientBoundaryChildren } from "../client-boundary-payload.ts";
import { isSafeSerializedPropName, serializeProps, stringifyProps } from "./prop-serializer.ts";
import {
  assertRscRenderCapacity,
  claimRscRenderNode,
  createRscRenderBudget,
  mapRscRenderChildren,
  type RscRenderBudget,
} from "./tree-budget.ts";

export { escapeHtml };

const SKIP_PROPS = new Set(["children", "key", "ref"]);
const HTML_TAG_PATTERN = /^[A-Za-z][A-Za-z0-9:_-]*$/;

export function renderAttributes(props: Record<string, unknown>): string {
  const attrs: string[] = [];

  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(props))) {
    if (descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) continue;
    const value = descriptor.value;
    if (value == null || SKIP_PROPS.has(key)) continue;
    if (!isSafeSerializedPropName(key)) continue;

    const attrName = key === "className" ? "class" : key === "htmlFor" ? "for" : key;

    if (typeof value === "boolean") {
      if (value) attrs.push(attrName);
      continue;
    }

    if (
      typeof value !== "string" &&
      typeof value !== "bigint" &&
      (typeof value !== "number" || !Number.isFinite(value))
    ) {
      continue;
    }

    attrs.push(`${attrName}="${escapeHtml(String(value))}"`);
  }

  return attrs.length ? ` ${attrs.join(" ")}` : "";
}

export async function treeToHTML(
  node: RSCNode,
  clientRefs?: ReadonlyMap<string, string>,
  clientManifest?: ReadonlyMap<string, ClientComponentMeta>,
  reactVersion?: string,
): Promise<string> {
  return await treeToHTMLWithBudget(
    node,
    clientRefs,
    clientManifest,
    reactVersion,
    createRscRenderBudget(),
    0,
  );
}

async function treeToHTMLWithBudget(
  sourceNode: RSCNode,
  clientRefs: ReadonlyMap<string, string> | undefined,
  clientManifest: ReadonlyMap<string, ClientComponentMeta> | undefined,
  reactVersion: string | undefined,
  budget: RscRenderBudget,
  depth: number,
): Promise<string> {
  claimRscRenderNode(budget, depth);
  const node = inspectRscNode(sourceNode);

  switch (node.type) {
    case "html":
      return node.text === undefined ? node.html ?? "" : escapeHtml(node.text);

    case "client": {
      const instanceId = `rsc-${crypto.randomUUID()}`;
      const propsJson = escapeHtml(stringifyProps(node.props ?? {}));
      const componentId = node.component ?? "";
      const moduleRef = clientRefs?.get(componentId) ?? componentId;
      const exports = clientManifest?.get(componentId)?.exports ?? [];
      const exportName = exports.includes(componentId)
        ? componentId
        : exports.includes("default")
        ? "default"
        : exports[0] ?? "default";
      const clientRef = moduleRef.includes("#") ? moduleRef : `${moduleRef}#${exportName}`;
      const children = inspectRscChildren(node.children, budget, depth + 1);
      const childrenHtml = await mapRscRenderChildren(
        children,
        (child) =>
          treeToHTMLWithBudget(
            child,
            clientRefs,
            clientManifest,
            reactVersion,
            budget,
            depth + 1,
          ),
      );
      const childrenPayload = children.length > 0
        ? ` data-rsc-children='${escapeHtml(encodeClientBoundaryChildren(children))}'`
        : "";
      return `<div data-client-ref="${escapeHtml(clientRef)}" data-rsc-component="${
        escapeHtml(componentId)
      }" data-rsc-props='${propsJson}'${childrenPayload} data-rsc-id="${instanceId}">${
        childrenHtml.join("")
      }</div>`;
    }

    case "server": {
      const children = inspectRscChildren(node.children, budget, depth + 1);
      if (!node.component) {
        const childrenHtml = await mapRscRenderChildren(
          children,
          (child) =>
            treeToHTMLWithBudget(
              child,
              clientRefs,
              clientManifest,
              reactVersion,
              budget,
              depth + 1,
            ),
        );
        return childrenHtml.join("");
      }

      const tag = node.component;
      if (!HTML_TAG_PATTERN.test(tag)) {
        throw new TypeError(`Invalid RSC server element tag: ${tag}`);
      }
      const childrenHtml = await mapRscRenderChildren(
        children,
        (child) =>
          treeToHTMLWithBudget(
            child,
            clientRefs,
            clientManifest,
            reactVersion,
            budget,
            depth + 1,
          ),
      );
      return await renderHostElement(
        tag,
        node.props ?? {},
        childrenHtml.join(""),
        reactVersion,
      );
    }

    case "fragment": {
      const children = inspectRscChildren(node.children, budget, depth + 1);
      const childrenHtml = await mapRscRenderChildren(
        children,
        (child) =>
          treeToHTMLWithBudget(
            child,
            clientRefs,
            clientManifest,
            reactVersion,
            budget,
            depth + 1,
          ),
      );
      return childrenHtml.join("");
    }
  }
}

export async function renderHostElement(
  tag: string,
  props: Record<string, unknown>,
  childrenHtml: string,
  reactVersion?: string,
): Promise<string> {
  if (!HTML_TAG_PATTERN.test(tag)) {
    throw new TypeError(`Invalid RSC server element tag: ${tag}`);
  }

  const serializedProps = serializeProps(props);
  let elementProps = serializedProps;
  if (childrenHtml.length > 0) {
    if (Object.hasOwn(serializedProps, "dangerouslySetInnerHTML")) {
      throw new TypeError(
        "RSC server elements cannot combine children with dangerouslySetInnerHTML",
      );
    }
    elementProps = {
      ...serializedProps,
      dangerouslySetInnerHTML: { __html: childrenHtml },
    };
  }

  return await renderToStaticMarkupAdapter(
    React.createElement(tag, elementProps),
    { reactVersion },
  );
}

function inspectRscNode(node: RSCNode): RSCNode {
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    throw new TypeError("RSC render nodes must be plain objects");
  }

  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(node);
    descriptors = Object.getOwnPropertyDescriptors(node);
  } catch {
    throw new TypeError("RSC render node could not be inspected safely");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("RSC render nodes must use a plain or null prototype");
  }

  const type = readRscNodeDataProperty(descriptors, "type");
  if (
    type !== "client" &&
    type !== "fragment" &&
    type !== "html" &&
    type !== "server"
  ) {
    throw new TypeError("RSC render node has an unsupported type");
  }

  const inspected: RSCNode = { type };
  for (const key of ["component", "props", "children", "html", "text"] as const) {
    const value = readRscNodeDataProperty(descriptors, key, true);
    if (value !== undefined) {
      Object.defineProperty(inspected, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    }
  }

  if (
    inspected.component !== undefined &&
    typeof inspected.component !== "string"
  ) {
    throw new TypeError("RSC render node component must be a string");
  }
  if (
    inspected.html !== undefined &&
    typeof inspected.html !== "string"
  ) {
    throw new TypeError("RSC render node html must be a string");
  }
  if (
    inspected.text !== undefined &&
    typeof inspected.text !== "string"
  ) {
    throw new TypeError("RSC render node text must be a string");
  }
  if (
    inspected.props !== undefined &&
    (typeof inspected.props !== "object" ||
      inspected.props === null ||
      Array.isArray(inspected.props))
  ) {
    throw new TypeError("RSC render node props must be an object");
  }

  return inspected;
}

function readRscNodeDataProperty(
  descriptors: PropertyDescriptorMap,
  key: keyof RSCNode,
  optional = false,
): unknown {
  const descriptor = descriptors[key];
  if (!descriptor) {
    if (optional) return undefined;
    throw new TypeError(`RSC render node is missing ${key}`);
  }
  if (descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) {
    throw new TypeError(`RSC render node ${key} must be an enumerable data property`);
  }
  return descriptor.value;
}

function inspectRscChildren(
  value: RSCNode[] | undefined,
  budget: RscRenderBudget,
  depth: number,
): RSCNode[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError("RSC render node children must be a plain array");
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !lengthDescriptor ||
    !Object.hasOwn(lengthDescriptor, "value") ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    throw new TypeError("RSC render node children have an invalid length");
  }
  const length = lengthDescriptor.value as number;
  assertRscRenderCapacity(budget, length, depth);

  const children = new Array<RSCNode>(length);
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, "value")
    ) {
      throw new TypeError("RSC render node children must be a dense data-only array");
    }
    children[index] = descriptor.value as RSCNode;
  }
  if (Reflect.ownKeys(value).length !== length + 1) {
    throw new TypeError("RSC render node children cannot define extra properties");
  }
  return children;
}
