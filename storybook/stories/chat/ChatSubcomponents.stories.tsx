import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { MessageActionBar, Reasoning, Sources, ToolCall } from "veryfront/chat";
import { StoryFrame } from "../support/StoryFrame";

const meta = {
  title: "Chat/Composition/Subcomponents",
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Subcomponents: Story = {
  render: () => (
    <StoryFrame maxWidth="720px">
      <div className="space-y-4">
        <Reasoning text="Checking the retrieved document snippets before answering." />
        <ToolCall
          tool={{
            type: "tool",
            toolCallId: "call-search",
            toolName: "searchDocs",
            state: "output-available",
            input: { query: "pricing terms" },
            output: { matches: 3 },
          }}
        />
        <Sources
          sources={[
            { title: "Agent guide", url: "https://example.com/agent-guide", score: 0.92 },
          ]}
        />
        <MessageActionBar onCopy={() => undefined} onRegenerate={() => undefined} />
      </div>
    </StoryFrame>
  ),
};
