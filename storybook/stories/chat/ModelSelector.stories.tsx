import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { ModelSelector } from "veryfront/chat";
import { modelOptions } from "../fixtures/chat";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const meta = {
  title: "Veryfront UI/Chat/ModelSelector",
  component: ModelSelector,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ModelSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [model, setModel] = React.useState(modelOptions[0]?.value);

    return (
      <StoryFrame maxWidth="420px">
        <ReviewSurface label="Closed">
          <ModelSelector
            models={modelOptions}
            value={model}
            onChange={setModel}
          />
        </ReviewSurface>
      </StoryFrame>
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <StoryFrame maxWidth="420px">
      <ReviewSurface label="Disabled">
        <ModelSelector
          models={modelOptions}
          value={modelOptions[1]?.value}
          onChange={() => undefined}
          disabled
        />
      </ReviewSurface>
    </StoryFrame>
  ),
};
