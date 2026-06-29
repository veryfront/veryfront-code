import type { Meta, StoryObj } from "@storybook/react-vite";
import { UploadsPanel } from "veryfront/chat";
import { uploads } from "../fixtures/chat";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const meta = {
  title: "Veryfront UI/Chat/UploadsPanel",
  component: UploadsPanel,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof UploadsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UploadedFiles: Story = {
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Uploaded files">
        <div className="h-[280px] rounded-[var(--radius-lg)] border border-[var(--outline-border)]">
          <UploadsPanel
            uploads={uploads}
            onRemoveUpload={() => undefined}
            onAttach={() => undefined}
          />
        </div>
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const Empty: Story = {
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Empty">
        <div className="h-[280px] rounded-[var(--radius-lg)] border border-[var(--outline-border)]">
          <UploadsPanel uploads={[]} onAttach={() => undefined} />
        </div>
      </ReviewSurface>
    </StoryFrame>
  ),
};
