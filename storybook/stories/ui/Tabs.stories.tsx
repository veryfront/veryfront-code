import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Tabs, TabsItem } from "../../../src/react/components/ui/index.ts";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

const importCode = `import { Tabs } from "veryfront/ui"`;

const compositionTree = `Tabs              <- Tablist container, manages active state
+-- TabsItem          <- Individual tab (button or anchor)`;

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
        title="Chat / Attachments"
        description="Two-way toggle for switching the composer between chat and its uploads panel."
      >
        <DocsExampleAuto of={ChatAttachments} />
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
          component="Tabs"
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
          component="TabsItem"
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
  title: "UI/Tabs",
  component: Tabs,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: TabsDocsPage },
  },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => {
    const [active, setActive] = useState("projects");
    return (
      <Tabs value={active} onValueChange={setActive}>
        <TabsItem value="projects">Projects</TabsItem>
        <TabsItem value="templates">Templates</TabsItem>
        <TabsItem value="settings">Settings</TabsItem>
      </Tabs>
    );
  },
};

export const ChatAttachments: Story = {
  name: "Chat / Attachments",
  tags: ["!dev"],
  render: () => {
    const [active, setActive] = useState("chat");
    return (
      <Tabs value={active} onValueChange={setActive}>
        <TabsItem value="chat">Chat</TabsItem>
        <TabsItem value="attachments">Attachments</TabsItem>
      </Tabs>
    );
  },
};

export const SmallSize: Story = {
  name: "Small Size",
  tags: ["!dev"],
  render: () => {
    const [active, setActive] = useState("jobs");
    return (
      <Tabs value={active} onValueChange={setActive} size="sm">
        <TabsItem value="jobs">Jobs</TabsItem>
        <TabsItem value="cron-jobs">Cron Jobs</TabsItem>
      </Tabs>
    );
  },
};

export const SecondaryHeader: Story = {
  name: "Secondary Header",
  tags: ["!dev"],
  render: () => {
    const [active, setActive] = useState("chunks");
    return (
      <Tabs value={active} onValueChange={setActive} size="sm">
        <TabsItem value="chunks">Chunks</TabsItem>
        <TabsItem value="embeddings">Embeddings</TabsItem>
        <TabsItem value="cache">Cache</TabsItem>
      </Tabs>
    );
  },
};

export const NavigationWithLinks: Story = {
  name: "Navigation with Links",
  tags: ["!dev"],
  render: () => {
    const [active, setActive] = useState("pricing");
    return (
      <Tabs value={active} onValueChange={setActive}>
        <TabsItem value="pricing" href="#pricing">
          Pricing
        </TabsItem>
        <TabsItem value="docs" href="#docs">
          Docs
        </TabsItem>
        <TabsItem value="blog" href="#blog">
          Blog
        </TabsItem>
      </Tabs>
    );
  },
};
