import type { RSCChildrenPayload, RSCNode } from "./types.ts";

const PAYLOAD_VERSION = 1 as const;
const MAX_PAYLOAD_DEPTH = 100;
const NODE_TYPES = new Set<RSCNode["type"]>([
  "server",
  "client",
  "html",
  "fragment",
]);

export interface ClientBoundaryElementRuntime {
  Fragment: unknown;
  createElement(
    type: unknown,
    props: Record<string, unknown>,
    ...children: unknown[]
  ): unknown;
}

export type ClientBoundaryComponentResolver = (componentId: string) => Promise<unknown>;

export function encodeClientBoundaryChildren(nodes: RSCNode[]): string {
  const payload: RSCChildrenPayload = { version: PAYLOAD_VERSION, nodes };
  return JSON.stringify(payload);
}

export function parseClientBoundaryChildren(serialized: string | undefined): RSCNode[] {
  if (!serialized) return [];

  try {
    const payload = JSON.parse(serialized) as unknown;
    if (!isChildrenPayload(payload)) return [];
    return payload.nodes;
  } catch {
    return [];
  }
}

export async function materializeClientBoundaryChildren(
  nodes: RSCNode[],
  runtime: ClientBoundaryElementRuntime,
  resolveClientComponent: ClientBoundaryComponentResolver,
): Promise<unknown[]> {
  return await Promise.all(
    nodes.map((node) => materializeNode(node, runtime, resolveClientComponent)),
  );
}

async function materializeNode(
  node: RSCNode,
  runtime: ClientBoundaryElementRuntime,
  resolveClientComponent: ClientBoundaryComponentResolver,
): Promise<unknown> {
  if (node.type === "html") return node.text ?? node.html ?? "";

  const children = await materializeClientBoundaryChildren(
    node.children ?? [],
    runtime,
    resolveClientComponent,
  );

  if (node.type === "fragment" || (node.type === "server" && !node.component)) {
    return runtime.createElement(runtime.Fragment, {}, ...children);
  }

  if (node.type === "server") {
    return runtime.createElement(node.component!, node.props ?? {}, ...children);
  }

  const Component = await resolveClientComponent(node.component!);
  if (!Component) return null;
  return runtime.createElement(Component, node.props ?? {}, ...children);
}

function isChildrenPayload(value: unknown): value is RSCChildrenPayload {
  if (!isRecord(value) || value.version !== PAYLOAD_VERSION || !Array.isArray(value.nodes)) {
    return false;
  }
  return value.nodes.every((node) => isRSCNode(node, 0));
}

function isRSCNode(value: unknown, depth: number): value is RSCNode {
  if (depth > MAX_PAYLOAD_DEPTH || !isRecord(value) || !NODE_TYPES.has(value.type as never)) {
    return false;
  }

  if (
    value.type === "html" && typeof value.html !== "string" && typeof value.text !== "string"
  ) return false;
  if (
    value.type === "client" &&
    typeof value.component !== "string"
  ) return false;
  if (
    value.type === "server" && value.component !== undefined && typeof value.component !== "string"
  ) {
    return false;
  }
  if (value.props !== undefined && !isRecord(value.props)) return false;
  if (value.children === undefined) return true;
  return Array.isArray(value.children) &&
    value.children.every((child) => isRSCNode(child, depth + 1));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
