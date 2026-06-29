import type { Meta, StoryObj } from "@storybook/react-vite";
import { AttachmentPill } from "veryfront/chat";
import { attachments } from "../fixtures/chat";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const meta = {
  title: "Veryfront UI/Chat/AttachmentPill",
  component: AttachmentPill,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AttachmentPill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  render: () => (
    <StoryFrame maxWidth="560px">
      <ReviewSurface label="Ready attachments">
        <div className="flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <AttachmentPill
              key={attachment.id}
              attachment={attachment}
              onRemove={() => undefined}
            />
          ))}
        </div>
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const Uploading: Story = {
  render: () => (
    <StoryFrame maxWidth="560px">
      <ReviewSurface label="Uploading">
        <AttachmentPill
          attachment={{
            id: "uploading",
            name: "run-export.csv",
            size: 48492,
            type: "csv",
            status: "uploading",
          }}
        />
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const WithPreview: Story = {
  render: () => (
    <StoryFrame maxWidth="560px">
      <ReviewSurface label="Preview on hover">
        <AttachmentPill
          attachment={{
            id: "preview",
            name: "handoff-notes.md",
            type: "md",
            size: 2418,
            preview:
              "Release notes: validate the agent run state, audit tool input, and verify error copy before deploy.",
          }}
          onRemove={() => undefined}
        />
      </ReviewSurface>
    </StoryFrame>
  ),
};
