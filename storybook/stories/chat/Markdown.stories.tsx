import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Markdown,
  type MarkdownRendererProps,
  MarkdownRendererProvider,
} from "veryfront/react/components/chat";
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

const compositionTree =
  `Markdown  <- dependency-free source boundary
  +-- children         <- exact Markdown source
  +-- renderer         <- explicit rich-renderer capability; null selects plain source
  +-- renderCodeBlock  <- forwarded only to the selected renderer
  +-- components       <- forwarded only to the selected renderer
  +-- className        <- merged onto the container
MarkdownRendererProvider  <- installs a renderer for a subtree`;

function PreviewRenderer({ source }: MarkdownRendererProps) {
  return (
    <article className="space-y-2" data-story-renderer="preview">
      <strong className="block">Extension renderer selected</strong>
      <pre className="whitespace-pre-wrap text-sm"><code>{source}</code></pre>
    </article>
  );
}

function MarkdownDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Markdown"
        lead="Presents escaped Markdown source by default and delegates semantic rendering only to an explicit extension-owned renderer."
      />

      <DocsSection
        title="Document"
        description="`Markdown` keeps source visible and escaped when no rich-renderer capability is installed."
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
          description="Markdown source and renderer-capability boundary"
          props={[
            {
              name: "children",
              type: "string",
              description: "Markdown content to render",
            },
            {
              name: "renderer",
              type: "MarkdownRenderer | null",
              description:
                "Per-instance rich renderer; null explicitly selects escaped plain source",
            },
            {
              name: "renderCodeBlock",
              type: "(props: CodeBlockProps) => ReactNode",
              description: "Fenced-code override forwarded to the selected renderer",
            },
            {
              name: "components",
              type: "MarkdownComponents",
              description: "Element overrides forwarded to the selected renderer",
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
  parameters: {
    docs: {
      source: {
        code: `import { Markdown } from "veryfront/react/components/chat";

<Markdown>{"## Heading\\n\\nProse with **bold**, a list, and a fenced code block."}</Markdown>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="760px">
      <ReviewSurface label="Markdown">
        <Markdown>{markdownExample}</Markdown>
      </ReviewSurface>
    </StoryFrame>
  ),
};

// Acid test: install one renderer capability without re-implementing the
// source boundary, container styling, or explicit plain-mode behavior.
export const InjectedRenderer: Story = {
  name: "Injected extension renderer",
  tags: ["!dev", "acid-test"],
  parameters: {
    docs: {
      source: {
        code: `import {
  Markdown,
  MarkdownRendererProvider,
} from "veryfront/react/components/chat";
import { ProjectMarkdownRenderer } from "./project-markdown-renderer";

<MarkdownRendererProvider renderer={ProjectMarkdownRenderer}>
  <Markdown>{markdown}</Markdown>
</MarkdownRendererProvider>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="760px">
      <ReviewSurface label="Injected renderer">
        <MarkdownRendererProvider renderer={PreviewRenderer}>
          <Markdown>{markdownExample}</Markdown>
        </MarkdownRendererProvider>
      </ReviewSurface>
    </StoryFrame>
  ),
};
