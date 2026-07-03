import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import {
  ChatContainer,
  InputBox,
  MessageList,
  SubmitButton,
} from "../../../src/react/primitives/index.ts";

const meta = {
  title: "Chat/Composition/React Primitives",
  tags: ["autodocs"],
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primitives: Story = {
  render: () => (
    <ChatContainer className="w-[420px] rounded-md border border-[var(--border)] p-4">
      <MessageList className="min-h-32">
        <div className="rounded-md bg-[var(--muted)] px-3 py-2 text-sm">
          Primitive message row
        </div>
      </MessageList>
      <div className="mt-4 flex gap-2">
        <InputBox value="Draft message" onChange={() => undefined} />
        <SubmitButton>Send</SubmitButton>
      </div>
    </ChatContainer>
  ),
};
