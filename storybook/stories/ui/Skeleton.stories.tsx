import type { Meta, StoryObj } from "@storybook/react-vite";
import { Skeleton } from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

function SkeletonDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Skeleton"
        lead="Animated placeholder bar. One per expected line; size with `w-*` / `h-*`."
      />
      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>
      <DocsSection title="Paragraph">
        <DocsExampleAuto of={Paragraph} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={`import { Skeleton } from "veryfront/chat/ui"`} />
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Skeleton"
          description="Extends <div> props; size with Tailwind w-/h- utilities"
          props={[
            {
              name: "className",
              type: "string",
              description: "Sizing / layout utilities",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Skeleton",
  component: Skeleton,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: SkeletonDocsPage } },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-80">
      <Skeleton />
    </div>
  ),
};
export const Paragraph: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex w-80 flex-col gap-2">
      <Skeleton className="w-1/2" />
      <Skeleton />
      <Skeleton className="w-3/4" />
    </div>
  ),
};
