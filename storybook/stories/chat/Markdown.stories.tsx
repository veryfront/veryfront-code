import type { Meta, StoryObj } from "@storybook/react-vite";
import { Markdown, RichCodeBlock } from "veryfront/react/components/chat";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { markdownExample } from "../fixtures/chat";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const importCode =
  `import { Markdown, RichCodeBlock } from "veryfront/react/components/chat"`;

const compositionTree = `Markdown  <- prose renderer (GFM, highlight, mermaid)
  +-- RichCodeBlock  <- fenced code blocks with copy button
  +-- table / blockquote / anchor  <- styled block overrides
RichCodeBlock  <- usable standalone for any code snippet`;

function MarkdownDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Markdown"
        lead="Renders chat markdown — GitHub-flavored syntax, syntax-highlighted code, tables, and mermaid diagrams — with `RichCodeBlock` for standalone code."
      />

      <DocsSection
        title="Document"
        description="`Markdown` takes a markdown string as children and renders a full prose document with GFM support."
      >
        <DocsExampleAuto of={Document} />
      </DocsSection>

      <DocsSection
        title="Code block"
        description="`RichCodeBlock` renders a fenced code snippet with a copy button — used by `Markdown` and available standalone."
      >
        <DocsExampleAuto of={CodeBlock} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Markdown"
          description="Markdown prose renderer"
          props={[
            {
              name: "children",
              type: "string",
              description: "Markdown content to render",
            },
            {
              name: "enableMermaid",
              type: "boolean",
              default: "true",
              description: "Render mermaid diagrams (client-side only)",
            },
            {
              name: "renderCodeBlock",
              type: "(props: CodeBlockProps) => ReactNode",
              description: "Custom renderer for code blocks",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class names for the container",
            },
          ]}
        />
        <DocsPropsTable
          component="RichCodeBlock"
          description="Fenced code block with copy button"
          props={[
            {
              name: "code",
              type: "string",
              description: "Source code to display",
            },
            {
              name: "language",
              type: "string",
              description: "Language for syntax highlighting",
            },
            {
              name: "inline",
              type: "boolean",
              description: "Render as inline code instead of a block",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class names",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Components/Markdown",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: MarkdownDocsPage },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Document: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="760px">
      <ReviewSurface label="Markdown">
        <Markdown>{markdownExample}</Markdown>
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const CodeBlock: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="760px">
      <ReviewSurface label="RichCodeBlock">
        <RichCodeBlock
          language="ts"
          code={[
            "const result = await vf.runTests({ filter: 'chat' });",
            "if (!result.success) throw new Error('Tests failed');",
          ].join("\n")}
        />
      </ReviewSurface>
    </StoryFrame>
  ),
};
