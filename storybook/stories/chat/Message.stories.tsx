import type { Meta, StoryObj } from "@storybook/react-vite";
import { Message, useMessageParts } from "veryfront/chat";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { chatMessages } from "../fixtures/chat";
import { StoryFrame } from "../support/StoryFrame";

const importCode = `import { Message } from "veryfront/chat"`;

const compositionTree = `Message  <- render it: <Message message={msg} />
Message.Root  <- or compose it: context (message, branch state)
  +-- Message.Header  <- agent avatar + name + timestamp (assistant)
  +-- Message.Content  <- body; no children = default loop, or a function child
  |     +-- Message.Part  <- default rendering for one grouped part
  |     +-- Message.Sources  <- inline citation sources
  +-- Message.Continuing  <- "Continuing…" shimmer while streaming
  +-- Message.Actions  <- copy / regenerate
  +-- Message.Tokens  <- token-usage popover (Model / Input / Output / Total)
  +-- Message.BranchPicker  <- optional: switch between regenerated responses`;

function MessageDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Message"
        lead="A single chat turn. Render `<Message message={msg} />` for the default anatomy, or compose `Message.Root` + `Message.*` parts for a custom layout. Like the `Chat` preset, userland decides."
      />

      <DocsSection
        title="Render"
        description="`<Message message={msg} />` renders the full turn: header, content, reasoning, tools, and actions. No composition required."
      >
        <DocsExampleAuto of={RenderPair} />
      </DocsSection>

      <DocsSection
        title="Compose: Assistant"
        description="Drop to `Message.Root` + parts to recompose the layout: content with sources and steps, actions, tokens."
      >
        <DocsExampleAuto of={CompoundAssistant} />
      </DocsSection>

      <DocsSection
        title="Compose: User"
        description="A minimal user turn with just content and actions."
      >
        <DocsExampleAuto of={CompoundUser} />
      </DocsSection>

      <DocsSection
        title="Streaming"
        description="Pass `isStreaming` to surface the `Continuing…` shimmer while the turn is still generating."
      >
        <DocsExampleAuto of={Streaming} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection
        title="Headless parts"
        description="Read the message's grouped parts as data with `useMessageParts()` (the 4th access point, alongside `Message.Part` and `Message.Content`) to build a fully custom body without reimplementing part grouping."
      >
        <DocsExampleAuto of={HeadlessParts} />
        <DocsCode code={headlessPartsCode} />
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Message"
          description="Render the default turn, or compose via Message.Root"
          props={[
            {
              name: "message",
              type: "ChatMessage",
              description: "The message to render",
            },
            {
              name: "isStreaming",
              type: "boolean",
              default: "false",
              description: "Show the 'Continuing…' shimmer while generating",
            },
            {
              name: "children",
              type: "ReactNode",
              description:
                "Compose your own layout; omit to render the default anatomy",
            },
            {
              name: "onReload",
              type: "() => void",
              description: "Regenerate handler that surfaces the retry action",
            },
          ]}
        />
        <DocsPropsTable
          component="Message.Root"
          description="Compound context provider for the parts below"
          props={[
            {
              name: "message",
              type: "ChatMessage",
              description: "The message to render",
            },
            {
              name: "onFeedback",
              type: "(value) => void",
              description: "Called when the user rates the message",
            },
            {
              name: "getBranches",
              type: "() => { current: number; total: number }",
              description: "Supplies branch state to BranchPicker",
            },
            {
              name: "switchBranch",
              type: "(direction) => void",
              description: "Navigate between regenerated responses",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Components/Message",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: MessageDocsPage },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const RenderPair: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { Message } from "veryfront/chat";

<div className="space-y-4">
  <Message message={userMessage} />
  <Message message={assistantMessage} onReload={() => regenerate()} />
</div>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="760px">
      <div className="space-y-4">
        <Message message={chatMessages[0]} />
        <Message message={chatMessages[1]} />
      </div>
    </StoryFrame>
  ),
};

export const CompoundAssistant: Story = {
  tags: ["!dev", "acid-test"],
  parameters: {
    docs: {
      source: {
        code: `import { Message } from "veryfront/chat";

// Own the body: special-case the parts you want (here, a custom tool view + a
// swapped code block), and fall back to Message.Part for everything else.
<Message.Root message={assistantMessage} onReload={() => regenerate()}>
  <Message.Header />
  <Message.Content codeBlock={MyCodeBlock}>
    {(part) =>
      part.type === "tool"
        ? <MyToolView tool={part.tool} />        // custom render for tool parts
        : <Message.Part part={part} />}          // default for text / reasoning
  </Message.Content>
  <Message.Sources />
  <div className="mt-1.5 flex items-center gap-0.5">
    <Message.Actions />
    <Message.Tokens />
  </div>
</Message.Root>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="760px">
      <Message.Root message={chatMessages[1]} onReload={() => undefined}>
        <Message.Header />
        <Message.Content>
          {(part) =>
            part.type === "tool"
              ? (
                <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--edge-medium)] px-3 py-2 text-xs text-[var(--faint)]">
                  Custom tool view → {part.tool.toolName}
                </div>
              )
              : <Message.Part part={part} />}
        </Message.Content>
        <Message.Sources />
        <div className="mt-1.5 flex items-center gap-0.5">
          <Message.Actions />
          <Message.Tokens />
        </div>
      </Message.Root>
    </StoryFrame>
  ),
};

export const CompoundUser: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { Message } from "veryfront/chat";

<Message.Root message={userMessage}>
  <Message.Content />
  <Message.Actions />
</Message.Root>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="760px">
      <Message.Root message={chatMessages[0]}>
        <Message.Content />
        <Message.Actions />
      </Message.Root>
    </StoryFrame>
  ),
};

export const Streaming: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { Message } from "veryfront/chat";

<Message message={assistantMessage} isStreaming />`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="760px">
      <Message message={chatMessages[1]} isStreaming />
    </StoryFrame>
  ),
};

// The 4th, headless access point to a message's parts: read them as data and
// render your own UI with no part grouping to reimplement.
const headlessPartsCode = `import { Message, useMessageParts } from "veryfront/chat";

function PartsSummary() {
  const { parts, textContent } = useMessageParts();
  return (
    <div>
      <span>{parts.length} part(s): {parts.map((p) => p.type).join(", ")}</span>
      <p>{textContent}</p>
    </div>
  );
}

<Message.Root message={assistantMessage}>
  <PartsSummary />
</Message.Root>`;

function PartsSummary() {
  const { parts, textContent } = useMessageParts();
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--edge-medium)] p-3 text-sm">
      <div className="mb-1 font-medium text-[var(--faint)]">
        {parts.length} part(s): {parts.map((p) => p.type).join(", ")}
      </div>
      <p className="text-[var(--foreground)]">{textContent}</p>
    </div>
  );
}

export const HeadlessParts: Story = {
  name: "Headless parts (useMessageParts)",
  tags: ["!dev"],
  parameters: {
    docs: { source: { code: headlessPartsCode } },
  },
  render: () => (
    <StoryFrame maxWidth="760px">
      <Message.Root message={chatMessages[1]}>
        <PartsSummary />
      </Message.Root>
    </StoryFrame>
  ),
};
