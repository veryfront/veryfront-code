import type { Meta, StoryObj } from "@storybook/react-vite";
import { CodeBlock } from "veryfront/chat";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const importCode = `import { CodeBlock } from "veryfront/chat"`;

const compositionTree =
  `CodeBlock  <- bordered surface: header + highlighted body
  +-- header      <- language label + Copy button
  +-- CodeSurface <- shiki HTML (github-light/dark), Skeleton while loading
  (language="mermaid" -> MermaidDiagram, rendered as an SVG diagram)`;

const tsxSample = `import { useState } from "react";

export function Counter({ start = 0 }: { start?: number }) {
  const [count, setCount] = useState(start);
  return (
    <button type="button" onClick={() => setCount((c) => c + 1)}>
      Count: {count}
    </button>
  );
}`;

const jsonSample = `{
  "name": "veryfront",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^19.2.4"
  }
}`;

const mermaidSample = `flowchart TD
  A[Prompt] --> B{Tool call?}
  B -- yes --> C[Run tool]
  C --> D[Stream result]
  B -- no --> D
  D --> E[Render message]`;

function CodeBlockDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="CodeBlock"
        lead="Syntax-highlighted code via shiki (`github-light`/`github-dark`, switched on color mode). Shiki and mermaid are lazy-loaded from esm.sh — a Skeleton shows while the highlighter spins up, and a plain `<pre>` is the graceful fallback."
      />

      <DocsSection
        title="TypeScript"
        description="A `tsx` sample. The language label and a Copy button sit in the header; the body is the shiki-rendered HTML."
      >
        <DocsExampleAuto of={TypeScript} />
      </DocsSection>

      <DocsSection
        title="JSON"
        description="Any shiki grammar works — the language id is loaded on demand."
      >
        <DocsExampleAuto of={Json} />
      </DocsSection>

      <DocsSection
        title="Collapsible"
        description="`collapsible` wraps the body in a toggle; `defaultCollapsed` starts it closed."
      >
        <DocsExampleAuto of={Collapsible} />
      </DocsSection>

      <DocsSection
        title="Mermaid"
        description={'`language="mermaid"` renders the fence as an SVG diagram instead of highlighted text.'}
      >
        <DocsExampleAuto of={Mermaid} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="CodeBlock"
          description="Syntax-highlighted code surface (or a mermaid diagram)"
          props={[
            {
              name: "code",
              type: "string",
              description: "The source code to render",
            },
            {
              name: "language",
              type: "string",
              description:
                'Language id for highlighting (e.g. tsx, json). Use "mermaid" to render a diagram',
            },
            {
              name: "collapsible",
              type: "boolean",
              description:
                "Render inside a collapsible shell (header stays, body toggles)",
            },
            {
              name: "defaultCollapsed",
              type: "boolean",
              description: "When collapsible, start collapsed",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class names for the outer container",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/CodeBlock",
  component: CodeBlock,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: CodeBlockDocsPage },
  },
} satisfies Meta<typeof CodeBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TypeScript: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { CodeBlock } from "veryfront/chat";

<CodeBlock language="tsx" code={\`import { useState } from "react";

export function Counter({ start = 0 }: { start?: number }) {
  const [count, setCount] = useState(start);
  return (
    <button type="button" onClick={() => setCount((c) => c + 1)}>
      Count: {count}
    </button>
  );
}\`} />`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="TypeScript">
        <CodeBlock language="tsx" code={tsxSample} />
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const Json: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { CodeBlock } from "veryfront/chat";

<CodeBlock language="json" code={\`{
  "name": "veryfront",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^19.2.4"
  }
}\`} />`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="JSON">
        <CodeBlock language="json" code={jsonSample} />
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const Collapsible: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { CodeBlock } from "veryfront/chat";

<CodeBlock
  language="tsx"
  code={source}
  collapsible
  defaultCollapsed
/>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Collapsible">
        <CodeBlock
          language="tsx"
          code={tsxSample}
          collapsible
          defaultCollapsed
        />
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const Mermaid: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { CodeBlock } from "veryfront/chat";

<CodeBlock language="mermaid" code={\`flowchart TD
  A[Prompt] --> B{Tool call?}
  B -- yes --> C[Run tool]
  C --> D[Stream result]
  B -- no --> D
  D --> E[Render message]\`} />`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Mermaid">
        <CodeBlock language="mermaid" code={mermaidSample} />
      </ReviewSurface>
    </StoryFrame>
  ),
};
