import type { RSCNode } from "../types.ts";
import { escapeHtml } from "#veryfront/html/html-escape.ts";
import { stringifyProps } from "./prop-serializer.ts";

export { escapeHtml };

const SKIP_PROPS = new Set(["children", "key", "ref"]);

export function renderAttributes(props: Record<string, unknown>): string {
  const attrs: string[] = [];

  for (const [key, value] of Object.entries(props)) {
    if (value == null || SKIP_PROPS.has(key)) continue;

    const attrName = key === "className" ? "class" : key;

    if (typeof value === "boolean") {
      if (value) attrs.push(attrName);
      continue;
    }

    attrs.push(`${attrName}="${escapeHtml(String(value))}"`);
  }

  return attrs.length ? ` ${attrs.join(" ")}` : "";
}

export async function treeToHTML(node: RSCNode): Promise<string> {
  if (node.type === "html") return node.html ?? "";

  if (node.type === "client") {
    const instanceId = `rsc-${crypto.randomUUID()}`;
    const propsJson = escapeHtml(stringifyProps(node.props ?? {}));
    return `<div data-rsc-component="${node.component}" data-rsc-props='${propsJson}' data-rsc-id="${instanceId}"></div>`;
  }

  if (node.type === "fragment" || node.type === "server") {
    const children = node.children ?? [];
    const childrenHtml = await Promise.all(children.map(treeToHTML));
    return childrenHtml.join("");
  }

  return "";
}
