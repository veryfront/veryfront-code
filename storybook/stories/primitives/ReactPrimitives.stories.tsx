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
import { completedToolPart, erroredToolPart } from "../fixtures/chat";

const meta = {
  title: "Veryfront UI/React Primitives",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const PrimitiveGallery: Story = {
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
