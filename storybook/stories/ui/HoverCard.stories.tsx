import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../../../src/react/components/ui/index.ts";

const importCode = `import { HoverCard, HoverCardContent, HoverCardTrigger } from "veryfront/ui"`;

function UserPreview() {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-base font-semibold text-[var(--foreground)]">Koji</span>
      <span className="text-[var(--muted-foreground)]">Design systems @ veryfront</span>
      <span className="mt-1 text-[var(--muted-foreground)]">
        Building the veryfront/ui primitive library.
      </span>
    </div>
  );
}

function HoverCardDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="HoverCard"
        lead="A non-modal preview card that opens on hover or focus of a trigger - for rich previews like a user card on a @mention."
      />

      <DocsSection
        title="Default"
        description="Hover (or focus) the mention to reveal the card. Opens after a short delay."
      >
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="Aligned to end" description="Align the card to the trigger's end edge.">
        <DocsExampleAuto of={Aligned} />
      </DocsSection>

      <DocsSection
        title="Instant"
        description="Zero openDelay / closeDelay for an immediate, snappy preview."
      >
        <DocsExampleAuto of={Instant} />
      </DocsSection>

      <DocsSection
        title="Controlled"
        description="Drive open via state + onOpenChange."
      >
        <DocsExampleAuto of={Controlled} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>HoverCard</DocsComposition>
      </DocsSection>

      <DocsSection title="API reference">
        <DocsPropsTable
          component="HoverCard"
          description="Root - owns open state on hover/focus"
          props={[
            {
              name: "open",
              type: "boolean",
              description: "Controlled open state (pair with onOpenChange)",
            },
            {
              name: "defaultOpen",
              type: "boolean",
              default: "false",
              description: "Initial open state when uncontrolled",
            },
            {
              name: "onOpenChange",
              type: "(open: boolean) => void",
              description: "Fires when the open state changes",
            },
            {
              name: "openDelay",
              type: "number",
              default: "700",
              description: "Delay in ms before the card opens after pointer enter",
            },
            {
              name: "closeDelay",
              type: "number",
              default: "300",
              description: "Delay in ms before the card closes after pointer leave",
            },
          ]}
        />
        <DocsPropsTable
          component="HoverCardContent"
          description="Portalled floating surface"
          props={[
            {
              name: "align",
              type: `"start" | "end"`,
              default: `"start"`,
              description: "Horizontal alignment relative to the trigger",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/HoverCard",
  component: HoverCard,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: HoverCardDocsPage },
  },
} satisfies Meta<typeof HoverCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <HoverCard>
      <HoverCardTrigger asChild>
        <a
          href="#koji"
          className="font-medium text-[var(--primary)] underline underline-offset-2"
        >
          @koji
        </a>
      </HoverCardTrigger>
      <HoverCardContent>
        <UserPreview />
      </HoverCardContent>
    </HoverCard>
  ),
};

export const Aligned: Story = {
  tags: ["!dev"],
  render: () => (
    <HoverCard>
      <HoverCardTrigger asChild>
        <a
          href="#koji"
          className="font-medium text-[var(--primary)] underline underline-offset-2"
        >
          @koji
        </a>
      </HoverCardTrigger>
      <HoverCardContent align="end">
        <UserPreview />
      </HoverCardContent>
    </HoverCard>
  ),
};

export const Instant: Story = {
  tags: ["!dev"],
  render: () => (
    <HoverCard openDelay={0} closeDelay={0}>
      <HoverCardTrigger>Hover me</HoverCardTrigger>
      <HoverCardContent>
        <UserPreview />
      </HoverCardContent>
    </HoverCard>
  ),
};

export const Controlled: Story = {
  tags: ["!dev"],
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <div className="flex flex-col items-center gap-3">
        <HoverCard open={open} onOpenChange={setOpen}>
          <HoverCardTrigger>@koji</HoverCardTrigger>
          <HoverCardContent>
            <UserPreview />
          </HoverCardContent>
        </HoverCard>
        <span className="text-[var(--muted-foreground)]">
          {open ? "open" : "closed"}
        </span>
      </div>
    );
  },
};
