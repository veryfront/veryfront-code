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
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "../../../src/react/components/ui/index.ts";

const importCode =
  `import { Drawer, DrawerTrigger, DrawerContent, DrawerTitle } from "veryfront/ui"`;

function DrawerDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Drawer"
        lead="An edge-anchored panel that slides in over the content."
      />

      <DocsSection title="Default" description="Trigger opens the panel; click the scrim or Escape to dismiss.">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="With sections" description="Compose DrawerHeader / DrawerBody / DrawerFooter.">
        <DocsExampleAuto of={WithSections} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{"Drawer > DrawerTrigger + DrawerContent"}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Drawer"
          description="Edge-anchored sliding panel"
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
              description: "Fires when the drawer opens or closes",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/Drawer",
  component: Drawer,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: DrawerDocsPage },
  },
} satisfies Meta<typeof Drawer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <Drawer>
      <DrawerTrigger asChild>
        <Button>Open drawer</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerTitle>Filters</DrawerTitle>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Panel content goes here.
        </p>
      </DrawerContent>
    </Drawer>
  ),
};

export const WithSections: Story = {
  name: "With sections",
  tags: ["!dev"],
  render: () => (
    <Drawer>
      <DrawerTrigger asChild>
        <Button>Edit profile</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Edit profile</DrawerTitle>
        </DrawerHeader>
        <DrawerBody>
          <p className="text-sm text-[var(--muted-foreground)]">
            Update your details, then save.
          </p>
        </DrawerBody>
        <DrawerFooter>
          <Button>Save</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  ),
};
