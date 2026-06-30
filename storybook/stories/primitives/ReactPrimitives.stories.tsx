import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import {
  AgentContainer,
  AgentStatus,
  ChatContainer,
  InputBox,
  LoadingIndicator,
  MessageContent,
  MessageItem,
  MessageList,
  MessageRole,
  SubmitButton,
  ThinkingIndicator,
  ToolInvocation,
  ToolList,
  ToolResult,
} from "../../../src/react/primitives/index.ts";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { completedToolPart, erroredToolPart } from "../fixtures/chat";

const importCode =
  `import { ChatContainer, MessageList, InputBox, SubmitButton } from "veryfront/react/primitives"`;

const compositionTree = `ChatContainer  <- unstyled wrapper (data-chat-container)
  +-- MessageList  <- role="log" region of turns
  |     +-- MessageItem  <- one turn (role)
  |           +-- MessageRole  <- role label
  |           +-- MessageContent  <- body
  +-- InputBox  <- controlled input / textarea
  +-- SubmitButton  <- submit / stop / voice states`;

function ReactPrimitivesDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Composition — React Primitives"
        lead="Unstyled, fully composable primitives — `ChatContainer`, `MessageList`, `InputBox`, and `SubmitButton` — for building a chat UI from scratch with your own styling."
      />

      <DocsSection
        title="Primitive gallery"
        description="The primitives stay unstyled; every class name here is supplied by the consumer."
      >
        <DocsExampleAuto of={PrimitiveGallery} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="ChatContainer"
          description="Unstyled wrapper element (data-chat-container). Forwards all div attributes."
          props={[
            {
              name: "children",
              type: "ReactNode",
              description: "Container content",
            },
            {
              name: "className",
              type: "string",
              description: "Class names applied to the wrapper div",
            },
          ]}
        />
        <DocsPropsTable
          component="MessageList"
          description="Live region (role=log, aria-live=polite) wrapping the turns. Forwards all div attributes."
          props={[
            {
              name: "children",
              type: "ReactNode",
              description: "Message items to render",
            },
            {
              name: "className",
              type: "string",
              description: "Class names applied to the list div",
            },
          ]}
        />
        <DocsPropsTable
          component="InputBox"
          description="Controlled input / textarea. Submits on Enter (Shift+Enter for newline)."
          props={[
            {
              name: "value",
              type: "string",
              description: "Controlled input value",
            },
            {
              name: "onChange",
              type: "(e: ChangeEvent) => void",
              description: "Called when the value changes",
            },
            {
              name: "onSubmit",
              type: "() => void",
              description: "Called on Enter (when not multiline-shifted)",
            },
            {
              name: "multiline",
              type: "boolean",
              description: "Render an auto-resizing textarea instead of an input",
            },
          ]}
        />
        <DocsPropsTable
          component="SubmitButton"
          description="Submit / stop / voice button that swaps icon and behavior by state."
          props={[
            {
              name: "hasInput",
              type: "boolean",
              description: "Whether the composer currently has input",
            },
            {
              name: "isLoading",
              type: "boolean",
              description: "Show the stop state while generating",
            },
            {
              name: "onStop",
              type: "() => void",
              description: "Called when stop is pressed during loading",
            },
            {
              name: "onVoice",
              type: "() => void",
              description: "Called when the voice control is pressed",
            },
            {
              name: "icons",
              type: "{ submit?; stop?; voice? }",
              description: "Override the default submit / stop / voice icons",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Composition/React Primitives",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: ReactPrimitivesDocsPage },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const PrimitiveGallery: Story = {
  tags: ["!dev"],
  render: () => {
    const [input, setInput] = React.useState("Primitive input");

    return (
      <div className="vf-story-canvas">
        <div className="mx-auto max-w-5xl vf-component-grid">
          <section className="vf-component-surface">
            <p className="vf-component-label">ChatContainer and MessageList</p>
            <ChatContainer className="rounded-[var(--radius-lg)] border border-[var(--outline-border)] p-3">
              <MessageList className="space-y-3">
                <MessageItem
                  role="user"
                  className="rounded-[var(--radius-lg)] bg-[var(--tertiary)] p-3"
                >
                  <MessageRole className="block text-xs font-semibold">
                    User
                  </MessageRole>
                  <MessageContent>
                    Show the primitive building blocks.
                  </MessageContent>
                </MessageItem>
                <MessageItem
                  role="assistant"
                  className="rounded-[var(--radius-lg)] border border-[var(--outline-border)] p-3"
                >
                  <MessageRole className="block text-xs font-semibold">
                    Assistant
                  </MessageRole>
                  <MessageContent>
                    These primitives remain unstyled and composable.
                  </MessageContent>
                </MessageItem>
              </MessageList>
            </ChatContainer>
          </section>

          <section className="vf-component-surface">
            <p className="vf-component-label">InputBox and SubmitButton</p>
            <div className="flex items-center gap-2 rounded-full border border-[var(--outline-border)] p-2">
              <InputBox
                className="min-w-0 flex-1 bg-transparent px-2 outline-none"
                value={input}
                onChange={(event) => setInput(event.currentTarget.value)}
              />
              <SubmitButton
                className="size-9 rounded-full bg-[var(--foreground)] text-[var(--background)]"
                hasInput={input.length > 0}
              />
            </div>
            <div className="mt-4 flex items-center gap-3">
              <SubmitButton
                className="size-9 rounded-full bg-[var(--tertiary)] text-[var(--foreground)]"
                isLoading
                onStop={() => undefined}
              />
              <LoadingIndicator className="size-2 rounded-full bg-[var(--foreground)]" />
            </div>
          </section>

          <section className="vf-component-surface">
            <p className="vf-component-label">Agent primitives</p>
            <AgentContainer className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--outline-border)] p-3">
              <AgentStatus
                status="thinking"
                className="inline-flex rounded-full bg-[var(--tertiary)] px-3 py-1 text-sm"
              />
              <ThinkingIndicator className="rounded-[var(--radius-lg)] bg-[var(--tertiary)] p-3">
                Evaluating tools...
              </ThinkingIndicator>
            </AgentContainer>
          </section>

          <section className="vf-component-surface">
            <p className="vf-component-label">Tool primitives</p>
            <ToolInvocation
              name="search_docs"
              input={{ query: "Veryfront runs" }}
              state="input-available"
              className="rounded-[var(--radius-lg)] border border-[var(--outline-border)] p-3"
            >
              <ToolResult output={{ matches: 3, status: "ready" }} />
            </ToolInvocation>
            <div className="mt-3">
              <ToolList
                tools={[completedToolPart, erroredToolPart]}
                className="space-y-2"
              />
            </div>
          </section>
        </div>
      </div>
    );
  },
};
