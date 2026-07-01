import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Tabs } from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

const importCode = `import { Tabs } from "veryfront/chat/ui"`;

const compositionTree = `Tabs.Root              <- Tablist container, manages active state
+-- Tabs.Item          <- Individual tab (button or anchor)`;

function TabsDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Tabs"
        lead="Filled top-level tab bar. Small tabs are flat, outlined, and 32px tall for panel headers. The active pill is static — no motion dependency."
      />

      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection
        title="Chat / Uploads"
        description="Two-way toggle for switching the composer between chat and its uploads panel."
      >
        <DocsExampleAuto of={ChatUploads} />
      </DocsSection>

      <DocsSection title="Small Size" description="Compact, flat, 32px.">
        <DocsExampleAuto of={SmallSize} />
      </DocsSection>

      <DocsSection
        title="Secondary Header"
        description="Flat 32px secondary bar used in panel headers."
      >
        <DocsExampleAuto of={SecondaryHeader} />
      </DocsSection>

      <DocsSection
        title="Navigation with Links"
        description={
          <>
            With <code>href</code>, items render as <code>&lt;a&gt;</code>.
          </>
        }
      >
        <DocsExampleAuto of={NavigationWithLinks} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Tabs.Root"
          description="Tablist container — manages active state and passes context to items"
          props={[
            {
              name: "value",
              type: "string",
              description: "The active tab value (controlled)",
            },
            {
              name: "onValueChange",
              type: "(value: string) => void",
              description: "Called with the value of the clicked tab",
            },
            {
              name: "size",
              type: '"default" | "sm"',
              default: '"default"',
              description: "Filled default bar, or flat 32px panel header",
            },
            {
              name: "className",
              type: "string",
              description: "Additional classes on the tablist container",
            },
          ]}
        />
        <DocsPropsTable
          component="Tabs.Item"
          description="Individual tab — renders as a button, or an anchor when href is set"
          props={[
            {
              name: "value",
              type: "string",
              description: "Identifies the tab; matched against Root's value",
            },
            {
              name: "href",
              type: "string",
              description: "Render as an <a> for navigation tabs",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Tabs",
  component: Tabs.Root,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: TabsDocsPage },
  },
} satisfies Meta<typeof Tabs.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => {
    const [active, setActive] = useState("projects");
    return (
      <Tabs.Root value={active} onValueChange={setActive}>
        <Tabs.Item value="projects">Projects</Tabs.Item>
        <Tabs.Item value="templates">Templates</Tabs.Item>
        <Tabs.Item value="settings">Settings</Tabs.Item>
      </Tabs.Root>
    );
  },
};

export const ChatUploads: Story = {
  name: "Chat / Uploads",
  tags: ["!dev"],
  render: () => {
    const [active, setActive] = useState("chat");
    return (
      <Tabs.Root value={active} onValueChange={setActive}>
        <Tabs.Item value="chat">Chat</Tabs.Item>
        <Tabs.Item value="uploads">Uploads</Tabs.Item>
      </Tabs.Root>
    );
  },
};

export const SmallSize: Story = {
  name: "Small Size",
  tags: ["!dev"],
  render: () => {
    const [active, setActive] = useState("jobs");
    return (
      <Tabs.Root value={active} onValueChange={setActive} size="sm">
        <Tabs.Item value="jobs">Jobs</Tabs.Item>
        <Tabs.Item value="cron-jobs">Cron Jobs</Tabs.Item>
      </Tabs.Root>
    );
  },
};

export const SecondaryHeader: Story = {
  name: "Secondary Header",
  tags: ["!dev"],
  render: () => {
    const [active, setActive] = useState("chunks");
    return (
      <Tabs.Root value={active} onValueChange={setActive} size="sm">
        <Tabs.Item value="chunks">Chunks</Tabs.Item>
        <Tabs.Item value="embeddings">Embeddings</Tabs.Item>
        <Tabs.Item value="cache">Cache</Tabs.Item>
      </Tabs.Root>
    );
  },
};

export const NavigationWithLinks: Story = {
  name: "Navigation with Links",
  tags: ["!dev"],
  render: () => {
    const [active, setActive] = useState("pricing");
    return (
      <Tabs.Root value={active} onValueChange={setActive}>
        <Tabs.Item value="pricing" href="#pricing">
          Pricing
        </Tabs.Item>
        <Tabs.Item value="docs" href="#docs">
          Docs
        </Tabs.Item>
        <Tabs.Item value="blog" href="#blog">
          Blog
        </Tabs.Item>
      </Tabs.Root>
    );
  },
};
