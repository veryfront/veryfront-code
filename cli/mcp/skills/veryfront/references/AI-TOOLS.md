# Veryfront tools reference

Tools expose typed callable capabilities to agents, workflows, and MCP surfaces.

## File location

Project tools live in `tools/`.

```text
tools/
  search-products.ts
```

Use one file per capability. Keep the file focused on input validation,
execution, and structured output.

## Create a tool

```ts
// tools/search-products.ts
import { defineSchema } from "veryfront/schemas";
import { tool } from "veryfront/tool";

interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
}

const products: Product[] = [
  { id: "prod_1", name: "Starter Kit", category: "kits", price: 49 },
  { id: "prod_2", name: "Team Plan", category: "plans", price: 199 },
];

const inputSchema = defineSchema((v) =>
  v.object({
    query: v.string().describe("Search query"),
    category: v.string().optional().describe("Optional category filter"),
    maxResults: v.number().default(10).describe("Maximum results to return"),
  })
)();

export default tool({
  id: "search-products",
  description: "Search products by name or category.",
  inputSchema,
  execute: async ({ query, category, maxResults }) => {
    const normalizedQuery = query.toLowerCase();

    return products
      .filter((product) => {
        const matchesQuery = product.name.toLowerCase().includes(normalizedQuery) ||
          product.category.toLowerCase().includes(normalizedQuery);
        const matchesCategory = category ? product.category === category : true;
        return matchesQuery && matchesCategory;
      })
      .slice(0, maxResults);
  },
});
```

## Scaffold a tool

```ts
vf_scaffold({
  type: "tool",
  name: "search-products",
});
```

This creates `tools/search-products.ts`.

## Tool shape

### `id`

Use a stable identifier when agents or workflows refer to the tool directly.
Keep it lowercase and descriptive, for example `search-products`.

### `description`

Describe the operation in one sentence. The model uses this text to decide when
to call the tool.

### `inputSchema`

Define tool input with `defineSchema`. Add `.describe()` to fields the model
must understand.

```ts
const inputSchema = defineSchema((v) =>
  v.object({
    to: v.string().email().describe("Recipient email address"),
    subject: v.string().max(200).describe("Email subject line"),
    body: v.string().describe("Email body"),
    priority: v.enum(["low", "normal", "high"]).default("normal"),
  })
)();
```

### `execute`

Return structured data. Throw errors with actionable messages.

```ts
execute: (async ({ orderId, status }) => {
  if (!orderId) throw new Error("Order ID is required");

  return {
    orderId,
    status,
    updated: true,
  };
});
```

## Common tool types

### Query tool

Use a query tool for read-only lookups.

```ts
// tools/get-user.ts
import { defineSchema } from "veryfront/schemas";
import { tool } from "veryfront/tool";

const inputSchema = defineSchema((v) =>
  v.object({
    userId: v.string().describe("User ID to look up"),
  })
)();

export default tool({
  id: "get-user",
  description: "Retrieve user details by ID.",
  inputSchema,
  execute: async ({ userId }) => {
    return {
      id: userId,
      name: "Example User",
    };
  },
});
```

### Mutation tool

Use a mutation tool for operations that write data. Check authorization before
changing state.

```ts
// tools/update-order-status.ts
import { defineSchema } from "veryfront/schemas";
import { tool } from "veryfront/tool";

const inputSchema = defineSchema((v) =>
  v.object({
    orderId: v.string().describe("Order ID"),
    status: v.enum(["pending", "processing", "shipped", "delivered", "cancelled"])
      .describe("New order status"),
    note: v.string().optional().describe("Optional status note"),
  })
)();

export default tool({
  id: "update-order-status",
  description: "Update the status of an order.",
  inputSchema,
  execute: async ({ orderId, status, note }, context) => {
    if (!context?.authToken) throw new Error("Authentication is required");

    return {
      success: true,
      orderId,
      status,
      note: note ?? null,
    };
  },
});
```

### Integration tool

Use an integration tool for external services. Keep secrets out of tool output.

```ts
// tools/send-slack-message.ts
import { defineSchema } from "veryfront/schemas";
import { tool } from "veryfront/tool";

const inputSchema = defineSchema((v) =>
  v.object({
    channel: v.string().describe("Slack channel name or ID"),
    message: v.string().describe("Message content"),
    threadTs: v.string().optional().describe("Thread timestamp to reply to"),
  })
)();

export default tool({
  id: "send-slack-message",
  description: "Send a message to a Slack channel.",
  inputSchema,
  execute: async ({ channel, message, threadTs }) => {
    return {
      success: true,
      channel,
      threadTs: threadTs ?? null,
      messageLength: message.length,
    };
  },
});
```

## Testing

Import the default tool and call `execute`. The tool validates input before the
implementation runs.

```ts
// tools/search-products.test.ts
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import searchProducts from "./search-products.ts";

describe("search-products", () => {
  it("validates input", async () => {
    await assertRejects(() => searchProducts.execute({ query: 123 } as never));
  });

  it("returns structured results", async () => {
    const result = await searchProducts.execute({ query: "team" });
    assertEquals(Array.isArray(result), true);
  });
});
```

## Guidelines

1. Keep each tool focused on one capability.
2. Validate all input with `defineSchema`.
3. Return objects or arrays instead of formatted prose.
4. Throw clear errors for invalid state, missing auth, and failed dependencies.
5. Keep long-running coordination in workflows or tasks.
6. Never return secrets, provider tokens, cookies, or private prompts.
