import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { AttachmentPill, ChatComposer, ModelSelector } from "veryfront/chat";
import type { ChatMessage } from "veryfront/chat";
import {
  attachments,
  chatMessages,
  createChangeHandler,
  modelOptions,
} from "../fixtures/chat";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const meta = {
  title: "Veryfront UI/Chat/ChatComposer",
  component: ChatComposer,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ChatComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

function ComposerReview({
  initialInput = "Draft a release checklist",
  isLoading = false,
  withAttachments = false,
}: {
  initialInput?: string;
  isLoading?: boolean;
  withAttachments?: boolean;
}): React.ReactElement {
  const [input, setInput] = React.useState(initialInput);
  const [model, setModel] = React.useState(modelOptions[0]?.value);
  const [messages] = React.useState<ChatMessage[]>(chatMessages);

  return (
    <StoryFrame maxWidth="820px">
      <ReviewSurface label="Composer">
        <ChatComposer
          input={input}
          onChange={createChangeHandler(setInput)}
          onSubmit={() => undefined}
          isLoading={isLoading}
          stop={() => undefined}
          models={modelOptions}
          model={model}
          onModelChange={setModel}
          onAttach={() => undefined}
          onSelectAttachment={() => undefined}
          attachments={withAttachments ? attachments : undefined}
          onRemoveAttachment={() => undefined}
          showExport
          messages={messages}
          className="pb-0"
        >
          {withAttachments
            ? attachments.map((attachment) => (
              <AttachmentPill key={attachment.id} attachment={attachment} />
            ))
            : null}
        </ChatComposer>
      </ReviewSurface>
    </StoryFrame>
  );
}

export const Default: Story = {
  render: () => <ComposerReview />,
};

export const WithAttachments: Story = {
  render: () => (
    <ComposerReview withAttachments initialInput="Review these files" />
  ),
};

export const Streaming: Story = {
  render: () => (
    <ComposerReview
      isLoading
      initialInput="Stop after this step"
    />
  ),
};

export const ModelOnly: Story = {
  render: () => {
    const [model, setModel] = React.useState(modelOptions[0]?.value);

    return (
      <StoryFrame maxWidth="420px">
        <ReviewSurface label="ModelSelector inside composer toolbar">
          <div className="flex justify-end">
            <ModelSelector
              models={modelOptions}
              value={model}
              onChange={setModel}
            />
          </div>
        </ReviewSurface>
      </StoryFrame>
    );
  },
};
