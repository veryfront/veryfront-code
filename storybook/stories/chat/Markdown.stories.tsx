import type { Meta, StoryObj } from "@storybook/react-vite";
import { Markdown, RichCodeBlock } from "veryfront/react/components/chat";
import { markdownExample } from "../fixtures/chat";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const meta = {
  title: "Veryfront UI/Chat/Markdown",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Document: Story = {
  render: () => (
    <StoryFrame maxWidth="760px">
      <ReviewSurface label="Markdown">
        <Markdown>{markdownExample}</Markdown>
      </ReviewSurface>
    </StoryFrame>
  ),
};

export const CodeBlock: Story = {
  render: () => (
    <StoryFrame maxWidth="760px">
      <ReviewSurface label="RichCodeBlock">
        <RichCodeBlock
          language="ts"
          code={[
            "const result = await vf.runTests({ filter: 'chat' });",
            "if (!result.success) throw new Error('Tests failed');",
          ].join("\n")}
        />
      </ReviewSurface>
    </StoryFrame>
  ),
};
