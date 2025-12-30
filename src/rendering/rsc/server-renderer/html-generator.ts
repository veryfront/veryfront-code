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

/**
 * Render HTML attributes from props
 *
 * @param props - Props object
 * @returns Attribute string (with leading space if non-empty)
 */
export function renderAttributes(props: Record<string, unknown>): string {
  const attrs: string[] = [];

  for (const [key, value] of Object.entries(props)) {
    // Skip children and special props
    if (key === "children" || key === "key" || key === "ref") continue;

    // Handle className -> class
    const attrName = key === "className" ? "class" : key;

    // Skip undefined/null values
    if (value === undefined || value === null) continue;

    // Handle boolean attributes
    if (typeof value === "boolean") {
      if (value) attrs.push(attrName);
      continue;
    }

    // Handle other values
    attrs.push(`${attrName}="${escapeHtml(String(value))}"`);
  }

  return attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
}

/**
 * Convert RSC tree to HTML
 *
 * @param node - RSC node to convert
 * @returns HTML string
 */
export async function treeToHTML(node: RSCNode): Promise<string> {
  switch (node.type) {
    case "html":
      return node.html || "";

    case "client": {
      // Generate unique ID for this instance
      const instanceId = `rsc-${crypto.randomUUID()}`;

      // Create placeholder element with data attributes
      const propsJson = JSON.stringify(node.props || {});

      return `<div data-rsc-component="${node.component}" data-rsc-props='${
        escapeHtml(
          propsJson,
        )
      }' data-rsc-id="${instanceId}"></div>`;
    }

    case "fragment": {
      // Render all children
      const childrenHtml = await Promise.all(
        (node.children || []).map((child) => treeToHTML(child)),
      );
      return childrenHtml.join("");
    }

    case "server": {
      // Server components should have been resolved to HTML
      const childrenHtml = await Promise.all(
        (node.children || []).map((child) => treeToHTML(child)),
      );
      return childrenHtml.join("");
    }

    default:
      return "";
  }
}
