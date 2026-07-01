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
import { Button, LoadingButton } from "../../../src/react/components/chat/ui/index.ts";
import {
  ArrowDownIcon,
  PlusIcon,
  SendIcon,
} from "../../../src/react/components/chat/icons/index.ts";

const importCode = `import { Button, LoadingButton } from "veryfront/chat/ui"`;

const compositionTree =
  `Button           <- <button> or Radix Slot (asChild)
LoadingButton    <- Button + subtle opacity pulse + aria-busy + disabled while pending`;

function ButtonDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Button"
        lead="Action element with variants, sizes, and loading state."
      />

      <DocsSection title="Primary">
        <DocsExampleAuto of={Primary} as={Button} />
      </DocsSection>

      <DocsSection title="Secondary">
        <DocsExampleAuto of={Secondary} as={Button} />
      </DocsSection>

      <DocsSection title="Tertiary">
        <DocsExampleAuto of={Tertiary} as={Button} />
      </DocsSection>

      <DocsSection title="Outline" description="Cancel/dismiss in dialogs.">
        <DocsExampleAuto of={Outline} as={Button} />
      </DocsSection>

      <DocsSection title="Link">
        <DocsExampleAuto of={Link} as={Button} />
      </DocsSection>

      <DocsSection
        title="Link with Arrow"
        description={
          <>
            <code>variant="link"</code> + <code>animateIcon</code>{" "}
            for "read more" affordances.
          </>
        }
      >
        <DocsExampleAuto of={LinkWithArrow} />
      </DocsSection>

      <DocsSection title="Ghost">
        <DocsExampleAuto of={Ghost} as={Button} />
      </DocsSection>

      <DocsSection title="Destructive" description="Irreversible actions only.">
        <DocsExampleAuto of={Destructive} as={Button} />
      </DocsSection>

      <DocsSection
        title="Icon"
        description={
          <>
            Always pair with <code>aria-label</code>.
          </>
        }
      >
        <DocsExampleAuto of={Icon} as={Button} />
      </DocsSection>

      <DocsSection
        title="Icon Ghost"
        description="Tree rows, toolbars, compact actions."
      >
        <DocsExampleAuto of={IconGhost} as={Button} />
      </DocsSection>

      <DocsSection title="Icon Secondary">
        <DocsExampleAuto of={IconSecondary} as={Button} />
      </DocsSection>

      <DocsSection title="With Icon">
        <DocsExampleAuto of={WithIcon} as={Button} />
      </DocsSection>

      <DocsSection
        title="Loading"
        description={
          <>
            Applies a subtle opacity pulse (<code>animate-button-loading</code>,
            1 → 0.55 → 1 over 1.4s), sets{" "}
            <code>aria-busy</code>, and blocks clicks. The label is unchanged —
            no verb swap, no spinner, no greying.
          </>
        }
      >
        <DocsExampleAuto of={Loading} />
      </DocsSection>

      <DocsSection title="Action Pair">
        <DocsExampleAuto of={ActionPair} />
      </DocsSection>

      <DocsSection title="Matrix">
        <DocsExampleAuto of={Matrix} />
      </DocsSection>

      <DocsSection title="Responsive">
        <DocsExampleAuto of={Responsive} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Button"
          description="Interactive element for triggering actions"
          props={[
            {
              name: "variant",
              type:
                "'primary' | 'secondary' | 'tertiary' | 'outline' | 'destructive' | 'link' | 'ghost' | 'text' | 'secondary-to-link' | 'icon-primary' | 'icon-ghost' | 'icon-secondary' | 'icon-tertiary'",
              default: "'primary'",
              description: "Visual style",
            },
            {
              name: "size",
              type:
                "'sm' | 'default' | 'lg' | 'lg-to-default' | 'icon-sm' | 'icon-default' | 'icon-lg' | 'icon-xl'",
              default: "'default'",
              description:
                "Height and padding preset (32 / 38 / 48). Icon variants 28 / 32 / 36 / 38.",
            },
            {
              name: "on",
              type: "'chrome' | 'card'",
              default: "'chrome'",
              description: "Surface the button sits on (drives hover pairing)",
            },
            {
              name: "iconAfter",
              type: "boolean",
              description:
                "Push icon to the trailing edge with justify-between",
            },
            {
              name: "asChild",
              type: "boolean",
              default: "false",
              description:
                "Render as Radix Slot, merging props onto the child element",
            },
            {
              name: "animateIcon",
              type: "boolean",
              default: "false",
              description: "Slide icon right on hover",
            },
            {
              name: "className",
              type: "string",
              description: "Additional classes",
            },
            {
              name: "children",
              type: "ReactNode",
              description: "Button content",
            },
          ]}
        />
        <DocsPropsTable
          component="LoadingButton"
          description="Button that pulses subtly while pending and blocks clicks"
          props={[
            {
              name: "isLoading",
              type: "boolean",
              description:
                "Pending state — applies the opacity pulse, sets aria-busy, disables clicks",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Button",
  component: Button,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: ButtonDocsPage },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

// Primary button
export const Primary: Story = {
  tags: ["!dev"],
  args: { children: "Get Started" },
  parameters: { docs: { source: { code: `<Button>Get Started</Button>` } } },
};

// Secondary button
export const Secondary: Story = {
  tags: ["!dev"],
  args: { variant: "secondary", children: "Learn More" },
  parameters: {
    docs: { source: { code: `<Button variant="secondary">Learn More</Button>` } },
  },
};

// Tertiary button
export const Tertiary: Story = {
  tags: ["!dev"],
  args: { variant: "tertiary", children: "View Details" },
  parameters: {
    docs: { source: { code: `<Button variant="tertiary">View Details</Button>` } },
  },
};

// Outline button
export const Outline: Story = {
  tags: ["!dev"],
  args: { variant: "outline", children: "Contact Us" },
  parameters: {
    docs: {
      source: { code: `<Button variant="outline" size="sm">Cancel</Button>` },
    },
  },
};

// Link button
export const Link: Story = {
  tags: ["!dev"],
  args: { variant: "link", children: "Read more" },
  parameters: {
    docs: { source: { code: `<Button variant="link">Read more</Button>` } },
  },
};

// Ghost button
export const Ghost: Story = {
  tags: ["!dev"],
  args: { variant: "ghost", children: "Cancel" },
  parameters: {
    docs: { source: { code: `<Button variant="ghost" size="sm">Dismiss</Button>` } },
  },
};

// Destructive button
export const Destructive: Story = {
  tags: ["!dev"],
  args: { variant: "destructive", size: "sm", children: "Delete" },
  parameters: {
    docs: {
      source: { code: `<Button variant="destructive" size="sm">Delete</Button>` },
    },
  },
};

// Icon button
export const Icon: Story = {
  tags: ["!dev"],
  args: {
    variant: "icon-primary",
    size: "icon-default",
    children: <ArrowDownIcon />,
  },
  parameters: {
    docs: {
      source: {
        code: `<Button variant="icon-primary" size="icon-lg" aria-label="Up">\n  <ArrowUp />\n</Button>`,
      },
    },
  },
};

// Icon Secondary button
export const IconSecondary: Story = {
  tags: ["!dev"],
  args: {
    variant: "icon-secondary",
    size: "icon-default",
    children: <ArrowDownIcon />,
  },
  parameters: {
    docs: {
      source: {
        code: `<Button variant="icon-secondary" size="icon-lg" aria-label="Copy">\n  <Copy />\n</Button>`,
      },
    },
  },
};

// Icon Ghost button
export const IconGhost: Story = {
  tags: ["!dev"],
  args: {
    variant: "icon-ghost",
    size: "icon-default",
    children: <ArrowDownIcon />,
  },
  parameters: {
    docs: {
      source: {
        code: `<Button variant="icon-ghost" size="icon-sm" aria-label="Add item">\n  <Plus />\n</Button>`,
      },
    },
  },
};

// With icon
export const WithIcon: Story = {
  tags: ["!dev"],
  args: {
    children: (
      <>
        Get Started
        <SendIcon />
      </>
    ),
  },
  parameters: {
    docs: {
      source: {
        code: `<Button size="sm">\n  <Send />\n  Send test message\n</Button>`,
      },
    },
  },
};

// Loading state — LoadingButton keeps the label stable and pulses opacity
// subtly while pending. No `source.code` override needed — the global
// `transformStorySource` emits clean JSX from the `render: () => (...)` wrapper.
export const Loading: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-4">
      <LoadingButton size="sm" isLoading={true}>
        Save changes
      </LoadingButton>
      <LoadingButton size="sm" isLoading={false}>
        Save changes
      </LoadingButton>
    </div>
  ),
};

// Action pair — primary + outline for confirm/cancel patterns.
export const ActionPair: Story = {
  name: "Action Pair",
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm">
        Cancel
      </Button>
      <Button size="sm">Confirm</Button>
    </div>
  ),
};

// Link with arrow (animates on hover)
export const LinkWithArrow: Story = {
  tags: ["!dev"],
  render: () => (
    <Button variant="link" animateIcon>
      Read more
      <SendIcon />
    </Button>
  ),
};

// Matrix of all variants x sizes
export const Matrix: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-4 items-center gap-4">
        {["Variant / Size", "Small (32px)", "Default (38px)", "Large (48px)"]
          .map((label) => (
            <div key={label} className="text-sm">
              {label}
            </div>
          ))}
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <div className="text-sm">Primary</div>
        <div>
          <Button size="sm">Try Veryfront Studio</Button>
        </div>
        <div>
          <Button size="default">Try Veryfront Studio</Button>
        </div>
        <div>
          <Button size="lg">Try Veryfront Studio</Button>
        </div>
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <div className="text-sm">Secondary</div>
        <div>
          <Button variant="secondary" size="sm">View Docs</Button>
        </div>
        <div>
          <Button variant="secondary" size="default">View Docs</Button>
        </div>
        <div>
          <Button variant="secondary" size="lg">View Docs</Button>
        </div>
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <div className="text-sm">Tertiary</div>
        <div>
          <Button variant="tertiary" size="sm">Customer Support Agent</Button>
        </div>
        <div>
          <Button variant="tertiary" size="default">
            Customer Support Agent
          </Button>
        </div>
        <div>
          <Button variant="tertiary" size="lg">Customer Support Agent</Button>
        </div>
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <div className="text-sm">Outline</div>
        <div>
          <Button variant="outline" size="sm">View Docs</Button>
        </div>
        <div>
          <Button variant="outline" size="default">View Docs</Button>
        </div>
        <div>
          <Button variant="outline" size="lg">View Docs</Button>
        </div>
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <div className="text-sm">Outline + Icon</div>
        <div>
          <Button variant="outline" size="sm" animateIcon>
            Process Automation
            <SendIcon />
          </Button>
        </div>
        <div>
          <Button variant="outline" size="default" animateIcon>
            Process Automation
            <SendIcon />
          </Button>
        </div>
        <div>
          <Button variant="outline" size="lg" animateIcon>
            Process Automation
            <SendIcon />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <div className="text-sm">Link</div>
        <div>
          <Button variant="link" size="sm">View Docs</Button>
        </div>
        <div>
          <Button variant="link" size="default">View Docs</Button>
        </div>
        <div>
          <Button variant="link" size="lg">View Docs</Button>
        </div>
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <div className="text-sm">Ghost</div>
        <div>
          <Button variant="ghost" size="sm">Sign In</Button>
        </div>
        <div>
          <Button variant="ghost" size="default">Sign In</Button>
        </div>
        <div>
          <Button variant="ghost" size="lg">Sign In</Button>
        </div>
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <div className="text-sm">Link + Arrow</div>
        <div>
          <Button variant="link" size="sm" animateIcon>
            View Docs
            <SendIcon />
          </Button>
        </div>
        <div>
          <Button variant="link" size="default" animateIcon>
            View Docs
            <SendIcon />
          </Button>
        </div>
        <div>
          <Button variant="link" size="lg" animateIcon>
            View Docs
            <SendIcon />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <div className="text-sm">Icon</div>
        <div>
          <Button variant="icon-primary" size="icon-default">
            <ArrowDownIcon />
          </Button>
        </div>
        <div>
          <Button variant="icon-primary" size="icon-default">
            <ArrowDownIcon />
          </Button>
        </div>
        <div>
          <Button variant="icon-primary" size="icon-lg">
            <ArrowDownIcon />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 items-center gap-4">
        <div className="text-sm">Icon Ghost</div>
        <div>
          <Button variant="icon-ghost" size="icon-default">
            <ArrowDownIcon />
          </Button>
        </div>
        <div>
          <Button variant="icon-ghost" size="icon-default">
            <ArrowDownIcon />
          </Button>
        </div>
        <div>
          <Button variant="icon-ghost" size="icon-lg">
            <ArrowDownIcon />
          </Button>
        </div>
      </div>
    </div>
  ),
};

// Responsive variants
export const Responsive: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="text-sm">Resize browser to see responsive behavior</div>

      <div className="flex flex-col gap-4">
        <div className="text-sm">
          lg-to-default (48px on mobile, 38px on md+)
        </div>
        <Button size="lg-to-default">Get Started</Button>
      </div>

      <div className="flex flex-col gap-4">
        <div className="text-sm">
          secondary-to-link (secondary on mobile, link on md+)
        </div>
        <Button variant="secondary-to-link">Learn More</Button>
      </div>
    </div>
  ),
};
