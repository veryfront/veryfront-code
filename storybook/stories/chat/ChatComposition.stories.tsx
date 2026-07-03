import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { ChatInput, ChatMessageList, ChatRoot, Message } from "veryfront/chat";
import { chatMessages, createChangeHandler } from "../fixtures/chat";
import { StoryFrame } from "../support/StoryFrame";

const meta = {
  title: "Chat/Composition/Anatomy",
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Anatomy: Story = {
  render: () => (
    <StoryFrame maxWidth="780px">
      <ChatRoot
        messages={chatMessages}
        input="Summarize the uploaded notes"
        onSubmit={(event?: React.FormEvent) => event?.preventDefault()}
      >
        <ChatMessageList messages={chatMessages} />
        <ChatInput
          input="Summarize the uploaded notes"
          onChange={createChangeHandler()}
          onSubmit={(event?: React.FormEvent) => event?.preventDefault()}
        />
        <div className="hidden">
          <Message message={chatMessages[0]!} />
        </div>
      </ChatRoot>
    </StoryFrame>
  ),
};
