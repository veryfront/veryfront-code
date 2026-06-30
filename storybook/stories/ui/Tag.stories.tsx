import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Tag,
  TagButton,
  TagGroup,
  TagLink,
} from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsSection,
} from "../../.storybook/docs";

const importCode =
  `import { Tag, TagLink, TagButton, TagGroup } from "veryfront/chat/ui"`;

function TagDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Tag"
        lead="Small rounded chip for metadata and labels, with link / button affordances and a wrapping group."
      />
      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>
      <DocsSection
        title="Link & Button"
        description="`TagLink` opens in a new tab; `TagButton` is interactive."
      >
        <DocsExampleAuto of={Interactive} />
      </DocsSection>
      <DocsSection title="Group" description="Wraps a row of tags with a gap.">
        <DocsExampleAuto of={Group} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Tag",
  component: Tag,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: TagDocsPage } },
} satisfies Meta<typeof Tag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => <Tag>typescript</Tag>,
};
export const Interactive: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-2">
      <TagLink href="https://example.com">docs</TagLink>
      <TagButton>filter</TagButton>
    </div>
  ),
};
export const Group: Story = {
  tags: ["!dev"],
  render: () => (
    <TagGroup>
      <Tag>react</Tag>
      <Tag>deno</Tag>
      <Tag>tailwind</Tag>
      <Tag>storybook</Tag>
    </TagGroup>
  ),
};
