import type { Meta, StoryObj } from "@storybook/react-vite";
import { Spinner } from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

function SpinnerDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Spinner"
        lead="The Veryfront brand mark doing a `bounce-spin` — the canonical loading indicator."
      />
      <DocsSection title="Default" description="Defaults to 28px (`size-7`).">
        <DocsExampleAuto of={Default} />
      </DocsSection>
      <DocsSection title="Sizes" description="Resize via `className`.">
        <DocsExampleAuto of={Sizes} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={`import { Spinner } from "veryfront/chat/ui"`} />
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Spinner"
          props={[
            { name: "className", type: "string", description: "Size / extra classes (default size-7)" },
            { name: "label", type: "string", default: "'Loading'", description: "Accessible label" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Spinner",
  component: Spinner,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: SpinnerDocsPage } },
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => <Spinner />,
};
export const Sizes: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-4">
      <Spinner className="size-4" />
      <Spinner className="size-7" />
      <Spinner className="size-10" />
    </div>
  ),
};
