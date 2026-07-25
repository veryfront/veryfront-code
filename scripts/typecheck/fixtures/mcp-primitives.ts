import { prompt, type PromptGenerateFn } from "veryfront/prompt";
import { resource, resourceRegistry } from "veryfront/resource";
import { defineSchema } from "veryfront/schemas";
import { registerResource } from "veryfront/mcp";

const generate: PromptGenerateFn = (variables) => `Hello ${String(variables.name)}`;

const welcome = prompt({
  id: "welcome",
  description: "Welcome a named user",
  generate,
});

const docs = resource({
  pattern: "/docs/:section",
  description: "Read documentation",
  paramsSchema: defineSchema((v) => v.object({ section: v.string() }))(),
  load: ({ section }) => ({ section }),
});

void welcome.getContent({ name: "Ada" });
void docs.load({ section: "agents" });
resourceRegistry.register(docs.id, docs);
registerResource(docs.id, docs);

prompt({
  id: "invalid-generator",
  description: "Generator output must be text",
  // @ts-expect-error Published prompt generators must not return non-string values.
  generate: () => 42,
});

// @ts-expect-error Published prompt configs require static content or a generator.
prompt({ id: "missing-content-source", description: "Invalid prompt" });
