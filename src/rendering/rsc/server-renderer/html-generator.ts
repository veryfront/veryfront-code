import type { ClientComponentMeta, RSCNode } from "../types.ts";
import { escapeHtml } from "#veryfront/html/html-escape.ts";
import { encodeClientBoundaryChildren } from "../client-boundary-payload.ts";
import { isSafeSerializedPropName, stringifyProps } from "./prop-serializer.ts";

export { escapeHtml };

const SKIP_PROPS = new Set(["children", "key", "ref"]);

export function renderAttributes(props: Record<string, unknown>): string {
  const attrs: string[] = [];

  for (const [key, value] of Object.entries(props)) {
    if (value == null || SKIP_PROPS.has(key)) continue;
    if (!isSafeSerializedPropName(key)) continue;

    const attrName = key === "className" ? "class" : key;

    if (typeof value === "boolean") {
      if (value) attrs.push(attrName);
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
): Promise<string> {
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
      const children = node.children ?? [];
      const childrenHtml = await Promise.all(
        children.map((child) => treeToHTML(child, clientRefs, clientManifest)),
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
      if (!node.component) {
        const childrenHtml = await Promise.all(
          (node.children ?? []).map((child) => treeToHTML(child, clientRefs, clientManifest)),
        );
        return childrenHtml.join("");
      }

      const tag = node.component;
      if (!/^[A-Za-z][A-Za-z0-9:_-]*$/.test(tag)) return "";
      const attrs = renderAttributes(node.props ?? {});
      const childrenHtml = await Promise.all(
        (node.children ?? []).map((child) => treeToHTML(child, clientRefs, clientManifest)),
      );
      return `<${tag}${attrs}>${childrenHtml.join("")}</${tag}>`;
    }

    case "fragment": {
      const children = node.children ?? [];
      const childrenHtml = await Promise.all(
        children.map((child) => treeToHTML(child, clientRefs, clientManifest)),
      );
      return childrenHtml.join("");
    }

    default:
      return "";
  }
}
