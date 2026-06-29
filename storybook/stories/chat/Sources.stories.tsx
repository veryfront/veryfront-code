import type { Meta, StoryObj } from "@storybook/react-vite";
import { InlineCitation, Sources } from "veryfront/chat";
import { sourceList } from "../fixtures/chat";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const meta = {
  title: "Veryfront UI/Chat/Sources",
  component: Sources,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof Sources>;

export default meta;
type Story = StoryObj<typeof meta>;

export const List: Story = {
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Sources">
        <Sources sources={sourceList} onSourceClick={() => undefined} />
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const Inline: Story = {
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="InlineCitation">
        <p className="text-sm leading-6 text-[var(--foreground)]">
          Agent runs emit AG-UI events and persist state{" "}
          <InlineCitation index={0} source={sourceList[0]} />{" "}
          while workflows keep durable step history{" "}
          <InlineCitation index={1} source={sourceList[1]} />.
        </p>
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const Empty: Story = {
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Empty">
        <Sources sources={[]} />
      </ReviewSurface>
    </StoryFrame>
  ),
};
