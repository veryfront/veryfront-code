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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../../../src/react/components/ui/index.ts";

const importCode =
  `import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "veryfront/ui"`;

function AccordionDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Accordion"
        lead="Stacked sections that expand and collapse: one at a time or many."
      />

      <DocsSection title="Single" description="type='single': opening one section closes the others.">
        <DocsExampleAuto of={Single} />
      </DocsSection>

      <DocsSection title="Collapsible" description="collapsible lets the open section close back to none.">
        <DocsExampleAuto of={Collapsible} />
      </DocsSection>

      <DocsSection title="Multiple" description="type='multiple': any number of sections stay open.">
        <DocsExampleAuto of={Multiple} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>
          {"Accordion > AccordionItem > AccordionTrigger + AccordionContent"}
        </DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Accordion"
          description="Stacked togglable sections"
          props={[
            {
              name: "type",
              type: "'single' | 'multiple'",
              default: "'single'",
              description: "One open section, or many",
            },
            {
              name: "collapsible",
              type: "boolean",
              description: "When single, allow closing back to none",
            },
            {
              name: "value",
              type: "string | string[]",
              description: "Controlled open value(s); pair with onValueChange",
            },
            {
              name: "defaultValue",
              type: "string | string[]",
              description: "Initial open value(s) when uncontrolled",
            },
            {
              name: "onValueChange",
              type: "((value: string) => void) | ((value: string[]) => void)",
              description: "Fires with a string in single mode or a string array in multiple mode",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/Accordion",
  component: Accordion,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: { page: AccordionDocsPage },
  },
} satisfies Meta<typeof Accordion>;

export default meta;
type Story = StoryObj<typeof meta>;

const items = [
  { value: "shipping", title: "Shipping", body: "Orders ship in 2-3 business days." },
  { value: "returns", title: "Returns", body: "Free returns within 30 days." },
  { value: "support", title: "Support", body: "Reach us any time at help@example.com." },
];

export const Single: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="mx-auto w-96">
      <Accordion type="single" defaultValue="shipping">
        {items.map((it) => (
          <AccordionItem key={it.value} value={it.value}>
            <AccordionTrigger>{it.title}</AccordionTrigger>
            <AccordionContent>{it.body}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  ),
};

export const Collapsible: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="mx-auto w-96">
      <Accordion type="single" collapsible defaultValue="shipping">
        {items.map((it) => (
          <AccordionItem key={it.value} value={it.value}>
            <AccordionTrigger>{it.title}</AccordionTrigger>
            <AccordionContent>{it.body}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  ),
};

export const Multiple: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="mx-auto w-96">
      <Accordion type="multiple" defaultValue={["shipping", "returns"]}>
        {items.map((it) => (
          <AccordionItem key={it.value} value={it.value}>
            <AccordionTrigger>{it.title}</AccordionTrigger>
            <AccordionContent>{it.body}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  ),
};
