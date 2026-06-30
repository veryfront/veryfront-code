import type { Meta, StoryObj } from "@storybook/react-vite";
import { UserAvatar } from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

function UserAvatarDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="UserAvatar"
        lead="Circular avatar — image when available, else initials. `primary` (brand) or `muted` (entities like agents)."
      />
      <DocsSection title="Tones">
        <DocsExampleAuto of={Tones} />
      </DocsSection>
      <DocsSection title="Accent colour">
        <DocsExampleAuto of={Accent} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={`import { UserAvatar } from "veryfront/chat/ui"`} />
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="UserAvatar"
          props={[
            { name: "name", type: "string", description: "Used for initials + alt" },
            { name: "avatarSrc", type: "string", description: "Image URL (falls back to initials)" },
            {
              name: "tone",
              type: "'primary' | 'muted'",
              default: "'primary'",
              description: "Brand bg + 2 initials, or grey bg + 1 letter",
            },
            {
              name: "variant",
              type: "'filled' | 'bordered'",
              default: "'filled'",
              description: "Accent fill vs accent ring",
            },
            { name: "accentColor", type: "string", description: "Custom accent colour" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/UserAvatar",
  component: UserAvatar,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: UserAvatarDocsPage } },
} satisfies Meta<typeof UserAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tones: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-4">
      <UserAvatar name="Ada Lovelace" />
      <UserAvatar name="Support Agent" tone="muted" />
    </div>
  ),
};
export const Accent: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-4">
      <UserAvatar name="Grace Hopper" accentColor="#6d28d9" />
      <UserAvatar name="Grace Hopper" accentColor="#6d28d9" variant="bordered" />
    </div>
  ),
};
