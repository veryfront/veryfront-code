# Veryfront AI Tools Reference

Build AI-powered features with Veryfront's native AI tool system.

## Overview

Veryfront provides first-class support for AI tools - functions that AI agents can call to perform actions. Tools are:

- **Typed** - Full TypeScript support with Zod schemas
- **Composable** - Build complex workflows from simple tools
- **Observable** - Built-in tracing and logging
- **Testable** - Easy to unit test in isolation

## Creating AI Tools

### Basic Structure

```ts
// ai/tools/search-products.ts
import { z } from "zod";

export const name = "search-products";

export const description = "Search for products by name, category, or price range";

export const parameters = z.object({
  query: z.string().describe("Search query"),
  category: z.string().optional().describe("Filter by category"),
  minPrice: z.number().optional().describe("Minimum price"),
  maxPrice: z.number().optional().describe("Maximum price"),
  limit: z.number().default(10).describe("Maximum results to return"),
});

export type Input = z.infer<typeof parameters>;

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
}

export async function execute(input: Input): Promise<Product[]> {
  const { query, category, minPrice, maxPrice, limit } = input;

  // Your implementation here
  const products = await db.products.search({
    query,
    category,
    priceRange: { min: minPrice, max: maxPrice },
    limit,
  });

  return products;
}
```

### Using the Scaffold

```
vf_scaffold({
  type: "ai-tool",
  name: "Search Products",
  slug: "search-products"
})
```

This creates the boilerplate structure in `ai/tools/search-products.ts`.

## Tool Anatomy

### name

Unique identifier for the tool. Use kebab-case.

```ts
export const name = "send-email";
```

**Guidelines:**

- Verb-noun format: `search-products`, `create-user`, `send-email`
- Descriptive but concise
- No special characters except hyphens

### description

Human-readable description of what the tool does. This is shown to the AI.

```ts
export const description = "Send an email to a recipient with subject and body";
```

**Guidelines:**

- Start with a verb
- Explain the action and its purpose
- Mention key parameters
- Keep under 200 characters

### parameters

Zod schema defining the input. Each field should have a `.describe()`.

```ts
export const parameters = z.object({
  to: z.string().email().describe("Recipient email address"),
  subject: z.string().max(200).describe("Email subject line"),
  body: z.string().describe("Email body in plain text or HTML"),
  priority: z.enum(["low", "normal", "high"]).default("normal")
    .describe("Email priority level"),
});
```

**Guidelines:**

- Use `.describe()` on every field - AI reads these
- Set sensible defaults with `.default()`
- Use `.optional()` for non-required fields
- Add validation: `.email()`, `.url()`, `.min()`, `.max()`

### execute

The function that performs the action. Must be async.

```ts
export async function execute(input: Input): Promise<Output> {
  // Implementation
}
```

**Guidelines:**

- Always return structured data, not formatted text
- Throw descriptive errors for failures
- Keep functions focused - one responsibility
- Use dependency injection for testability

## Return Types

### Structured Data

Return objects or arrays that can be processed further:

```ts
// Good - Structured
return {
  success: true,
  orderId: "ord_123",
  total: 99.99,
  items: [{ id: "item_1", quantity: 2 }],
};

// Bad - Formatted text
return "Order ord_123 created successfully with total $99.99";
```

### Error Handling

Throw errors with clear messages:

```ts
export async function execute(input: Input) {
  const product = await db.products.findById(input.productId);

  if (!product) {
    throw new Error(`Product not found: ${input.productId}`);
  }

  if (product.stock < input.quantity) {
    throw new Error(
      `Insufficient stock. Available: ${product.stock}, Requested: ${input.quantity}`,
    );
  }

  return await createOrder(product, input.quantity);
}
```

### Pagination

For list operations, return pagination info:

```ts
interface SearchResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export async function execute(input: Input): Promise<SearchResult<Product>> {
  const { items, total } = await db.products.search({
    query: input.query,
    skip: (input.page - 1) * input.pageSize,
    take: input.pageSize,
  });

  return {
    items,
    total,
    page: input.page,
    pageSize: input.pageSize,
    hasMore: input.page * input.pageSize < total,
  };
}
```

## Tool Categories

### Query Tools

Read-only operations that fetch data.

```ts
// ai/tools/get-user.ts
export const name = "get-user";
export const description = "Retrieve user details by ID";

export const parameters = z.object({
  userId: z.string().describe("User ID to look up"),
});

export async function execute({ userId }) {
  return await db.users.findById(userId);
}
```

### Mutation Tools

Operations that create, update, or delete data.

```ts
// ai/tools/update-order-status.ts
export const name = "update-order-status";
export const description = "Update the status of an order";

export const parameters = z.object({
  orderId: z.string().describe("Order ID"),
  status: z.enum(["pending", "processing", "shipped", "delivered", "cancelled"])
    .describe("New order status"),
  note: z.string().optional().describe("Optional note about the status change"),
});

export async function execute({ orderId, status, note }) {
  const order = await db.orders.update(orderId, { status, note });
  await notifyCustomer(order);
  return { success: true, order };
}
```

### Integration Tools

Tools that interact with external services.

```ts
// ai/tools/send-slack-message.ts
export const name = "send-slack-message";
export const description = "Send a message to a Slack channel";

export const parameters = z.object({
  channel: z.string().describe("Slack channel name or ID"),
  message: z.string().describe("Message content"),
  threadTs: z.string().optional().describe("Thread timestamp to reply to"),
});

export async function execute({ channel, message, threadTs }) {
  const result = await slack.chat.postMessage({
    channel,
    text: message,
    thread_ts: threadTs,
  });

  return {
    success: true,
    messageTs: result.ts,
    channel: result.channel,
  };
}
```

### Computation Tools

Tools that perform calculations or transformations.

```ts
// ai/tools/calculate-shipping.ts
export const name = "calculate-shipping";
export const description = "Calculate shipping cost based on destination and weight";

export const parameters = z.object({
  origin: z.string().describe("Origin zip code"),
  destination: z.string().describe("Destination zip code"),
  weightKg: z.number().positive().describe("Package weight in kilograms"),
  service: z.enum(["standard", "express", "overnight"]).describe("Shipping service"),
});

export async function execute(input) {
  const rate = await shippingProvider.getRate(input);
  return {
    cost: rate.cost,
    currency: "USD",
    estimatedDays: rate.transitDays,
    carrier: rate.carrier,
  };
}
```

## Composing Tools

### Tool Dependencies

Tools can use other tools internally:

```ts
// ai/tools/process-refund.ts
import { execute as getOrder } from "./get-order";
import { execute as updateOrderStatus } from "./update-order-status";
import { execute as createRefund } from "./create-refund";

export async function execute({ orderId, reason }) {
  // Get order details
  const order = await getOrder({ orderId });

  if (order.status === "refunded") {
    throw new Error("Order already refunded");
  }

  // Create refund
  const refund = await createRefund({
    amount: order.total,
    orderId,
    reason,
  });

  // Update order status
  await updateOrderStatus({
    orderId,
    status: "refunded",
    note: `Refund ${refund.id}: ${reason}`,
  });

  return { success: true, refundId: refund.id };
}
```

### Tool Pipelines

Create higher-level tools that orchestrate multiple operations:

```ts
// ai/tools/onboard-customer.ts
export const name = "onboard-customer";
export const description = "Complete customer onboarding process";

export const parameters = z.object({
  email: z.string().email(),
  name: z.string(),
  plan: z.enum(["free", "pro", "enterprise"]),
});

export async function execute(input) {
  // 1. Create account
  const user = await createUser({ email: input.email, name: input.name });

  // 2. Set up subscription
  const subscription = await createSubscription({
    userId: user.id,
    plan: input.plan,
  });

  // 3. Send welcome email
  await sendEmail({
    to: input.email,
    template: "welcome",
    data: { name: input.name, plan: input.plan },
  });

  // 4. Create initial resources
  await createDefaultWorkspace({ userId: user.id });

  return {
    userId: user.id,
    subscriptionId: subscription.id,
    status: "onboarded",
  };
}
```

## Testing Tools

### Unit Tests

```ts
// ai/tools/search-products.test.ts
import { describe, expect, it, vi } from "vitest";
import { execute, parameters } from "./search-products";

describe("search-products", () => {
  it("validates input", () => {
    expect(() => parameters.parse({})).toThrow();
    expect(() => parameters.parse({ query: "" })).not.toThrow();
  });

  it("returns matching products", async () => {
    vi.mock("../db", () => ({
      products: {
        search: vi.fn().mockResolvedValue([
          { id: "1", name: "Widget", price: 10 },
        ]),
      },
    }));

    const result = await execute({ query: "widget" });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Widget");
  });

  it("handles empty results", async () => {
    const result = await execute({ query: "nonexistent" });
    expect(result).toEqual([]);
  });
});
```

### Integration Tests

```ts
// ai/tools/create-order.integration.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execute } from "./create-order";
import { setupTestDb, teardownTestDb } from "../test-utils";

describe("create-order integration", () => {
  beforeAll(setupTestDb);
  afterAll(teardownTestDb);

  it("creates order and updates inventory", async () => {
    const result = await execute({
      customerId: "test-customer",
      items: [{ productId: "prod-1", quantity: 2 }],
    });

    expect(result.success).toBe(true);
    expect(result.orderId).toBeDefined();

    // Verify inventory was updated
    const product = await db.products.findById("prod-1");
    expect(product.stock).toBe(8); // Was 10, ordered 2
  });
});
```

## Best Practices

1. **Single Responsibility** - Each tool does one thing well
2. **Clear Descriptions** - AI needs good descriptions to use tools correctly
3. **Structured Returns** - Return data, not formatted text
4. **Graceful Errors** - Throw descriptive errors, handle edge cases
5. **Idempotency** - Mutation tools should be safe to retry
6. **Validation** - Validate all inputs with Zod
7. **Testing** - Unit test logic, integration test side effects
8. **Documentation** - Document complex tools with examples

## Security Considerations

1. **Authorization** - Check user permissions in tools
2. **Input Sanitization** - Don't trust AI-provided inputs blindly
3. **Rate Limiting** - Protect expensive operations
4. **Audit Logging** - Log sensitive tool executions
5. **Secrets** - Never expose API keys in tool outputs
