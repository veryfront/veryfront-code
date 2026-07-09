import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { Skeleton } from "../../../src/react/components/ui/index.ts";

const importCode = `import { Skeleton } from "veryfront/ui"`;

const compositionTree = `Skeleton`;

function SkeletonDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Skeleton"
        lead="Loading placeholder bar. Size with w-*/h-* utilities."
      />

      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection
        title="Avatar + name"
        description="Compose to match content shape."
      >
        <DocsExampleAuto of={Avatar} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Skeleton"
          description="Animated placeholder div"
          props={[
            {
              name: "className",
              type: "string",
              description:
                "Size and shape utilities (w-* / h-* / rounded-*) layered onto the pulsing base bar",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/Skeleton",
  component: Skeleton,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: SkeletonDocsPage },
  },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-2 w-80">
      <Skeleton className="w-2/3" />
      <Skeleton className="w-1/2" />
      <Skeleton className="w-1/3" />
    </div>
  ),
};

export const Avatar: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-3">
      <Skeleton className="size-10 rounded-full" />
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  ),
};
