export interface NodeTypeStyle {
  badge: string;
  node: string;
}

const DEFAULT_NODE_TYPE_STYLE: NodeTypeStyle = {
  badge: "bg-gray-100 text-gray-600",
  node: "bg-gray-50 border-gray-200 text-gray-700",
};

const NODE_TYPE_STYLES: Record<string, NodeTypeStyle> = {
  step: {
    badge: "bg-blue-50 text-blue-600",
    node: "bg-blue-50 border-blue-200 text-blue-700",
  },
  parallel: {
    badge: "bg-green-50 text-green-600",
    node: "bg-green-50 border-green-200 text-green-700",
  },
  branch: {
    badge: "bg-yellow-50 text-yellow-700",
    node: "bg-yellow-50 border-yellow-200 text-yellow-700",
  },
  wait: {
    badge: "bg-orange-50 text-orange-600",
    node: "bg-orange-50 border-orange-200 text-orange-700",
  },
};

export function getNodeTypeStyle(type: string): NodeTypeStyle {
  return NODE_TYPE_STYLES[type] ?? DEFAULT_NODE_TYPE_STYLE;
}

export function filterItemsByIdSearch<T extends { id: string }>(items: T[], search: string): T[] {
  const searchLower = search.toLowerCase();
  return items.filter((item) => item.id.toLowerCase().includes(searchLower));
}

export function generateExampleFromSchema(
  schema?: Record<string, unknown>,
): Record<string, unknown> {
  if (!schema || schema.type !== "object") return {};

  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties) return {};

  const example: Record<string, unknown> = {};

  for (const [name, prop] of Object.entries(properties)) {
    if (prop.default !== undefined) {
      example[name] = prop.default;
      continue;
    }

    if (Array.isArray(prop.enum) && prop.enum.length > 0) {
      example[name] = prop.enum[0];
      continue;
    }

    const nameLower = name.toLowerCase();

    switch (prop.type) {
      case "string":
        if (nameLower.includes("url") || nameLower.includes("uri")) {
          example[name] = "https://example.com/data";
        } else if (nameLower.includes("email")) {
          example[name] = "user@example.com";
        } else {
          example[name] = `example-${name}`;
        }
        break;
      case "number":
      case "integer":
        example[name] = 1;
        break;
      case "boolean":
        example[name] = true;
        break;
      case "array":
        example[name] = [];
        break;
      case "object":
        example[name] = generateExampleFromSchema(prop as Record<string, unknown>);
        break;
      default:
        example[name] = null;
    }
  }

  return example;
}
