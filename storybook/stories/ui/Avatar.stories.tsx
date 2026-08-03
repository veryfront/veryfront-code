import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Avatar,
} from "../../../src/react/components/ui/index.ts";
import { cx as cn } from "../../../src/react/components/ui/index.ts";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

// NOTE: Studio's `cn` helper is imported from our chat `theme.ts`. Studio's
// `TooltipArrow` is not exported by our barrel (the basic Tooltip has no
// arrow), so the "Active Users" example renders the accent-coloured tooltips
// without a pointer arrow.

const importCode = `import { Avatar } from "veryfront/ui"`;

function AvatarDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Avatar"
        lead="Circular user avatar — photo or initials fallback with optional accent colour."
      />

      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="With Image">
        <DocsExampleAuto of={WithImage} />
      </DocsSection>

      <DocsSection
        title="Sizes"
        description="Default is size-8. Override via className."
      >
        <DocsExampleAuto of={Sizes} />
      </DocsSection>

      <DocsSection
        title="Bordered"
        description={
          <>
            <code>variant="bordered"</code>{" "}
            renders the accent as a ring instead of a fill.
          </>
        }
      >
        <DocsExampleAuto of={Bordered} />
      </DocsSection>

      <DocsSection
        title="Stacked Avatars"
        description="Bordered avatars overlap to form the ActiveUsers group."
      >
        <DocsExampleAuto of={StackedAvatars} />
      </DocsSection>

      <DocsSection
        title="Active Users"
        description="Stack with accent-coloured tooltips and an overflow counter."
      >
        <DocsExampleAuto of={ActiveUsers} />
      </DocsSection>

      <DocsSection
        title="Email Fallback"
        description="Initial derived from the local part before @."
      >
        <DocsExampleAuto of={EmailFallback} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>
          {`Avatar  <- Circular avatar with image or initials fallback`}
        </DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Avatar"
          description="Circular user avatar with image or initials fallback"
          props={[
            {
              name: "name",
              type: "string",
              description:
                "User display name or email. Used for initials fallback and alt text on the image.",
            },
            {
              name: "avatarSrc",
              type: "string",
              description:
                "URL of the user photo. When provided, renders an img element that fills the circle.",
            },
            {
              name: "accentColor",
              type: "string",
              description:
                "CSS colour value. In filled variant fills the background; in bordered variant sets the border colour only.",
            },
            {
              name: "variant",
              type: "'filled' | 'bordered'",
              default: "'filled'",
              description:
                "Visual style. filled fills the background with accentColor. bordered renders only a coloured ring.",
            },
            {
              name: "tone",
              type: "'primary' | 'muted'",
              default: "'primary'",
              description:
                "primary uses the brand background and two-letter initials; muted uses a grey background and a single letter.",
            },
            {
              name: "className",
              type: "string",
              description:
                "Additional classes. Use Tailwind size-* classes to override the default size-8.",
            },
            {
              name: "ref",
              type: "React.Ref<HTMLDivElement>",
              description: "Forwarded ref to the root div.",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/Avatar",
  component: Avatar,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: AvatarDocsPage },
  },
  args: { name: "Priya Patel" },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => <Avatar name="Priya Patel" />,
};

export const WithImage: Story = {
  name: "With Image",
  tags: ["!dev"],
  render: () => (
    <Avatar name="Priya Patel" avatarSrc="https://i.pravatar.cc/150" />
  ),
};

export const Sizes: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-3">
      <Avatar name="Priya Patel" className="size-5" />
      <Avatar name="Priya Patel" className="size-6" />
      <Avatar name="Priya Patel" />
      <Avatar name="Priya Patel" className="size-9" />
    </div>
  ),
};

export const Bordered: Story = {
  tags: ["!dev"],
  render: () => (
    <Avatar name="Priya Patel" variant="bordered" accentColor="#3b82f6" />
  ),
};

export const StackedAvatars: Story = {
  name: "Stacked Avatars",
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center">
      <Avatar
        name="Priya Patel"
        accentColor="#3b82f6"
        variant="bordered"
        className="relative ring-2 ring-background"
      />
      <Avatar
        name="Sarah Chen"
        accentColor="#10b981"
        variant="bordered"
        className="relative -ml-2.5 ring-2 ring-background"
      />
      <Avatar
        name="Alex Rivera"
        accentColor="#f59e0b"
        variant="bordered"
        className="relative -ml-2.5 ring-2 ring-background"
      />
    </div>
  ),
};

const activeUsers = [
  { name: "Priya Patel", color: "#3b82f6" },
  { name: "Sarah Chen", color: "#10b981" },
  { name: "Alex Rivera", color: "#f59e0b" },
];

export const ActiveUsers: Story = {
  name: "Active Users",
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center">
      {activeUsers.map((user, index) => (
        <TooltipProvider key={user.name}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Avatar
                name={user.name}
                accentColor={user.color}
                variant="bordered"
                className={cn(
                  "relative ring-2 ring-background",
                  index > 0 && "-ml-2.5",
                )}
                style={{ zIndex: activeUsers.length - index }}
              />
            </TooltipTrigger>
            <TooltipContent
              className="border-none text-faint"
              style={{ backgroundColor: user.color }}
            >
              {user.name}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
      <div className="ml-1.5 inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-[var(--accent)] px-2 text-xs font-medium ring-2 ring-background">
        +2
      </div>
    </div>
  ),
};

export const EmailFallback: Story = {
  name: "Email Fallback",
  tags: ["!dev"],
  render: () => <Avatar name="user@example.com" />,
};
