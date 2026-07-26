import {
  prompt,
  type PromptGenerateFn,
  promptRegistry,
} from "veryfront/prompt";
import {
  type McpContentConfig,
  resource,
  resourceRegistry,
  type ResourceLoadContext,
} from "veryfront/resource";
import { defineSchema } from "veryfront/schemas";
import { registerResource } from "veryfront/mcp";
import { skillRegistry } from "veryfront/skill";
import { toolRegistry } from "veryfront/tool";

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

const markdownContent: McpContentConfig = {
  type: "text",
  mimeType: "text/markdown",
};
const readme = resource({
  pattern: "docs://readme",
  description: "Read the project README",
  paramsSchema: defineSchema((v) => v.object({}))(),
  mcp: { content: markdownContent },
  load: (_params, context?: Readonly<ResourceLoadContext>) => {
    void context?.uri;
    return "# Project\n";
  },
});
void readme.load({}, {
  abortSignal: new AbortController().signal,
  uri: "docs://readme",
});

prompt({
  id: "invalid-generator",
  description: "Generator output must be text",
  // @ts-expect-error Published prompt generators must not return non-string values.
  generate: () => 42,
});

// @ts-expect-error Published prompt configs require static content or a generator.
prompt({ id: "missing-content-source", description: "Invalid prompt" });

// Project code may mutate only its current registry scope.
// @ts-expect-error Process-wide shared registration is framework-internal.
promptRegistry.registerShared("welcome", welcome);
// @ts-expect-error Process-wide reset is framework-internal.
promptRegistry.clearAll();
// @ts-expect-error Aggregate cross-scope statistics are framework-internal.
promptRegistry.getStats();
// @ts-expect-error Process-wide shared registration is framework-internal.
resourceRegistry.registerShared(docs.id, docs);
// @ts-expect-error Process-wide reset is framework-internal.
toolRegistry.clearAll();
// @ts-expect-error Aggregate cross-scope statistics are framework-internal.
skillRegistry.getStats();
