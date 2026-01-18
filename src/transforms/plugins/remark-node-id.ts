import type { Root } from "mdast";
import type { Node } from "unist";
import { visit } from "unist-util-visit";

interface FileData {
  nodeMap?: Map<number, unknown>;
  nodeCount?: number;
}

interface VFile {
  data?: FileData;
}

export function remarkAddNodeId(options: { prefix?: string; includePosition?: boolean } = {}) {
  const { prefix = "node", includePosition = true } = options;

  return (tree: Root, file: VFile) => {
    let nodeId = 0;
    const nodeMap = new Map<
      number,
      { id: string; type: string; position?: unknown; value?: unknown }
    >();

    visit(tree as unknown as Root, (node: Node) => {
      if (["yaml", "toml", "mdxjsEsm", "mdxjsFlow"].includes(String(node.type))) {
        return;
      }

      if (!node.data) {
        node.data = {};
      }

      if (!(node.data as Record<string, unknown>).hProperties) {
        (node.data as Record<string, unknown>).hProperties = {};
      }

      const id = `${prefix}-${nodeId}`;
      ((node.data as Record<string, unknown>).hProperties as Record<string, unknown>)[
        "data-node-id"
      ] = id;

      if (includePosition && node.position) {
        const pos = node.position as {
          start: { offset: number; line: number; column: number };
          end: { offset: number; line: number; column: number };
        };
        ((node.data as Record<string, unknown>).hProperties as Record<string, unknown>)[
          "data-node-start"
        ] = pos.start.offset;
        ((node.data as Record<string, unknown>).hProperties as Record<string, unknown>)[
          "data-node-end"
        ] = pos.end.offset;
        ((node.data as Record<string, unknown>).hProperties as Record<string, unknown>)[
          "data-node-line"
        ] = pos.start.line;
        ((node.data as Record<string, unknown>).hProperties as Record<string, unknown>)[
          "data-node-column"
        ] = pos.start.column;
        ((node.data as Record<string, unknown>).hProperties as Record<string, unknown>)[
          "data-node-end-line"
        ] = pos.end.line;
        ((node.data as Record<string, unknown>).hProperties as Record<string, unknown>)[
          "data-node-end-column"
        ] = pos.end.column;
      }

      nodeMap.set(nodeId, {
        id,
        type: node.type,
        position: node.position,
        value: (node as { value?: unknown }).value,
      });

      nodeId++;
    });

    if (!file.data) {
      file.data = {};
    }
    file.data.nodeMap = nodeMap;
    file.data.nodeCount = nodeId;
  };
}
