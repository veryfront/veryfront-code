import type { Meta, StoryObj } from "@storybook/react-vite";
import type * as React from "react";
import {
  Tag,
  TagButton,
  TagGroup,
  TagLink,
} from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

const importCode =
  `import { Tag, TagLink, TagButton, TagGroup } from "veryfront/chat/ui"`;

const compositionTree = `Tag              <- Static pill label
TagLink          <- Anchor pill with hover state
TagButton        <- Button pill with hover state
TagGroup         <- Flex-wrap container for tags`;

function TagDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Tag"
        lead="Pill-shaped label for categories, links, and interactive tags."
      />

      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="Link" description="Opens in a new tab by default.">
        <DocsExampleAuto of={Link} />
      </DocsSection>

      <DocsSection title="Button">
        <DocsExampleAuto of={AsButton} />
      </DocsSection>

      <DocsSection title="Group" description="Flex-wrap layout for tag lists.">
        <DocsExampleAuto of={Group} />
      </DocsSection>

      <DocsSection title="Real-world: Template Card">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Tag"
          description="Static pill label"
          props={[
            {
              name: "children",
              type: "React.ReactNode",
              description: "Label content",
            },
            {
              name: "className",
              type: "string",
              description: "Additional classes",
            },
          ]}
        />
        <DocsPropsTable
          component="TagLink"
          description="Anchor pill with hover state"
          props={[
            {
              name: "href",
              type: "string",
              description: "Destination URL (opens in a new tab)",
            },
          ]}
        />
        <DocsPropsTable
          component="TagButton"
          description="Button pill with hover state"
          props={[
            {
              name: "onClick",
              type: "(e: MouseEvent) => void",
              description: "Click handler",
            },
          ]}
        />
        <DocsPropsTable
          component="TagGroup"
          description="Flex-wrap container for tags"
          props={[
            {
              name: "children",
              type: "React.ReactNode",
              description: "Tags to lay out",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Tag",
  component: Tag,
  subcomponents: { TagLink, TagButton, TagGroup },
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: TagDocsPage },
  },
  args: {
    children: null as React.ReactNode,
  },
} satisfies Meta<typeof Tag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => <Tag>Coming Soon</Tag>,
};

export const Link: Story = {
  tags: ["!dev"],
  render: () => <TagLink href="https://ui.shadcn.com">shadcn/ui</TagLink>,
};

export const AsButton: Story = {
  name: "Button",
  tags: ["!dev"],
  render: () => <TagButton onClick={() => {}}>Show More</TagButton>,
};

export const Group: Story = {
  tags: ["!dev"],
  render: () => (
    <TagGroup>
      <TagLink href="https://ui.shadcn.com">shadcn/ui</TagLink>
      <TagLink href="https://magicui.design">Magic UI</TagLink>
      <TagLink href="https://ui.aceternity.com">Aceternity</TagLink>
      <TagButton onClick={() => {}}>...</TagButton>
    </TagGroup>
  ),
};
