
import type { RSCNode } from "../types.ts";

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderAttributes(props: Record<string, unknown>): string {
  const attrs: string[] = [];

  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || key === "key" || key === "ref") continue;

    const attrName = key === "className" ? "class" : key;

    if (value === undefined || value === null) continue;

    if (typeof value === "boolean") {
      if (value) attrs.push(attrName);
      continue;
    }

    attrs.push(`${attrName}="${escapeHtml(String(value))}"`);
  }

  return attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
}

export async function treeToHTML(node: RSCNode): Promise<string> {
  switch (node.type) {
    case "html":
      return node.html || "";

    case "client": {
      const instanceId = `rsc-${crypto.randomUUID()}`;

      const propsJson = JSON.stringify(node.props || {});

      return `<div data-rsc-component="${node.component}" data-rsc-props='${
        escapeHtml(
          propsJson,
        )
      }' data-rsc-id="${instanceId}"></div>`;
    }

    case "fragment": {
      const childrenHtml = await Promise.all(
        (node.children || []).map((child) => treeToHTML(child)),
      );
      return childrenHtml.join("");
    }

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
