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

const compositionTree =
  `Markdown  <- prose renderer; no exported sub-parts — configure it with props
  +-- children         <- the markdown string to render (GFM + highlighting)
  +-- renderCodeBlock  <- swap the fenced-code renderer (defaults to CodeBlock)
  +-- components        <- override element renderers (anchor / table / heading / …)
  +-- remarkPlugins / rehypePlugins  <- extra plugins, appended to the built-ins
  +-- className         <- merged onto the container (via cn)`;

function MarkdownDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Markdown"
        lead="Renders chat markdown with GitHub-flavored syntax, syntax-highlighted code, and tables. Fenced code renders through the shiki-based `CodeBlock` primitive (UI/CodeBlock)."
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
              name: "renderCodeBlock",
              type: "(props: CodeBlockProps) => ReactNode",
              description: "Custom renderer for code blocks",
            },
            {
              name: "components",
              type: "Components",
              description:
                "Override element renderers (anchor / table / heading / blockquote / …), merged over the built-in defaults",
            },
            {
              name: "remarkPlugins",
              type: "PluggableList",
              description: "Extra remark plugins, appended after the built-ins (GFM etc.)",
            },
            {
              name: "rehypePlugins",
              type: "PluggableList",
              description: "Extra rehype plugins, appended after the built-ins",
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

// Acid test: swap ONE leaf — the fenced-code renderer — via `renderCodeBlock`,
// without re-implementing `Markdown`. Prose, lists, and inline formatting keep
// the default rendering; only code blocks change.
export const CustomCodeBlock: Story = {
  name: "Custom code block (renderCodeBlock)",
  tags: ["!dev", "acid-test"],
  parameters: {
    docs: {
      source: {
        code: `import { Markdown } from "veryfront/react/components/chat";

<Markdown
  renderCodeBlock={({ code, language }) => (
    <pre className="rounded-md bg-[var(--foreground)] p-3 text-[var(--background)]">
      <span className="mb-1 block text-xs opacity-60">{language ?? "code"}</span>
      <code>{code}</code>
    </pre>
  )}
>
  {markdown}
</Markdown>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="760px">
      <ReviewSurface label="Custom code block">
        <Markdown
          renderCodeBlock={({ code, language }) => (
            <pre className="overflow-x-auto rounded-md bg-[var(--foreground)] p-3 text-[var(--background)]">
              <span className="mb-1 block text-xs opacity-60">{language ?? "code"}</span>
              <code>{code}</code>
            </pre>
          )}
        >
          {markdownExample}
        </Markdown>
      </ReviewSurface>
    </StoryFrame>
  ),
};
