import type { Meta, StoryObj } from "@storybook/react-vite";
import { Markdown } from "veryfront/react/components/chat";
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

const importCode = `import { Markdown } from "veryfront/react/components/chat"`;

const compositionTree = `Markdown  <- prose renderer (GFM, highlight, mermaid)
  +-- CodeBlock  <- fenced code blocks (shiki + copy), see Chat/UI/CodeBlock
  +-- table / blockquote / anchor  <- styled block overrides`;

function MarkdownDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Markdown"
        lead="Renders chat markdown — GitHub-flavored syntax, syntax-highlighted code, tables, and mermaid diagrams. Fenced code renders through the shiki-based `CodeBlock` primitive (Chat/UI/CodeBlock)."
      />

      <DocsSection
        title="Document"
        description="`Markdown` takes a markdown string as children and renders a full prose document with GFM support — including syntax-highlighted fenced code blocks."
      >
        <DocsExampleAuto of={Document} />
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
