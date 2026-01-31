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

type HProperties = Record<string, unknown>;
type NodeData = { hProperties?: HProperties } & Record<string, unknown>;

export function remarkAddNodeId(
  options: { prefix?: string; includePosition?: boolean } = {},
): (tree: Root, file: VFile) => void {
  const { prefix = "node", includePosition = true } = options;

  return (tree: Root, file: VFile): void => {
    let nodeId = 0;
    const nodeMap = new Map<
      number,
      { id: string; type: string; position?: unknown; value?: unknown }
    >();

    visit(tree, (node: Node) => {
      const type = String(node.type);
      if (type === "yaml" || type === "toml" || type === "mdxjsEsm" || type === "mdxjsFlow") {
        return;
      }

      node.data ??= {};
      const data = node.data as NodeData;
      data.hProperties ??= {};
      const hProperties = data.hProperties;

      const id = `${prefix}-${nodeId}`;
      hProperties["data-node-id"] = id;

      if (includePosition && node.position) {
        const { start, end } = node.position as {
          start: { offset: number; line: number; column: number };
          end: { offset: number; line: number; column: number };
        };

        hProperties["data-node-start"] = start.offset;
        hProperties["data-node-end"] = end.offset;
        hProperties["data-node-line"] = start.line;
        hProperties["data-node-column"] = start.column;
        hProperties["data-node-end-line"] = end.line;
        hProperties["data-node-end-column"] = end.column;
      }

      nodeMap.set(nodeId, {
        id,
        type: node.type,
        position: node.position,
        value: (node as { value?: unknown }).value,
      });

      nodeId++;
    });

    file.data ??= {};
    file.data.nodeMap = nodeMap;
    file.data.nodeCount = nodeId;
  };
}
