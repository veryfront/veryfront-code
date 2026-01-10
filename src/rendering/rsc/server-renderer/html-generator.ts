/**
 * HTML generation utilities for RSC renderer
 *
 * This module handles conversion of RSC trees to HTML strings,
 * including attribute rendering and HTML escaping.
 *
 * @module html-generator
 */

import type { RSCNode } from "../types.ts";
import { escapeHtml } from "../../../html/html-escape.ts";

export { escapeHtml };

const SKIP_PROPS = new Set(["children", "key", "ref"]);

/**
 * Render HTML attributes from props
 */
export function renderAttributes(props: Record<string, unknown>): string {
  const attrs: string[] = [];

  for (const [key, value] of Object.entries(props)) {
    if (SKIP_PROPS.has(key) || value === undefined || value === null) continue;

    const attrName = key === "className" ? "class" : key;

    if (typeof value === "boolean") {
      if (value) attrs.push(attrName);
    } else {
      attrs.push(`${attrName}="${escapeHtml(String(value))}"`);
    }
  }

  return attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
}

/**
 * Convert RSC tree to HTML
 */
export async function treeToHTML(node: RSCNode): Promise<string> {
  switch (node.type) {
    case "html":
      return node.html || "";

    case "client": {
      const instanceId = `rsc-${crypto.randomUUID()}`;
      const propsJson = escapeHtml(JSON.stringify(node.props || {}));
      return `<div data-rsc-component="${node.component}" data-rsc-props='${propsJson}' data-rsc-id="${instanceId}"></div>`;
    }

    case "fragment":
    case "server": {
      const childrenHtml = await Promise.all(
        (node.children || []).map((child) => treeToHTML(child)),
      );
      return childrenHtml.join("");
    }

    default:
      return "";
  }
}
