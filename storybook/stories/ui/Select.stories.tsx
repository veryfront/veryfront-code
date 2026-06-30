import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
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
  `import {
  Select, SelectTrigger, SelectValue, SelectContent,
  SelectItem, SelectGroup, SelectLabel, SelectSeparator,
} from "veryfront/chat/ui"`;

const compositionTree =
  `Select              <- owns value + open state
  +-- SelectTrigger      <- shows SelectValue + chevron, toggles the listbox
  |    +-- SelectValue      <- selected option's label, or a placeholder
  +-- SelectContent      <- listbox below the trigger; outside-click / Escape dismiss
       +-- SelectGroup        <- groups options
            +-- SelectLabel       <- group heading
            +-- SelectItem        <- option (check when selected, closes on select)
            +-- SelectSeparator   <- divider`;

function SelectDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Select"
        lead="A single-select listbox — the model picker, option fields. Basic behavior (outside-click / Escape dismiss); full keyboard a11y is TODO."
      />
      <DocsSection title="Default" description="Click to open; pick an option.">
        <DocsExampleAuto of={Default} />
      </DocsSection>
      <DocsSection title="Grouped" description="Labels and a separator.">
        <DocsExampleAuto of={Grouped} />
      </DocsSection>
      <DocsSection title="Sizes">
        <DocsExampleAuto of={Sizes} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>
      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Select"
          props={[
            { name: "value / defaultValue", type: "string", description: "Controlled / uncontrolled selection" },
            { name: "onValueChange", type: "(value) => void", description: "Selection callback" },
          ]}
        />
        <DocsPropsTable
          component="SelectTrigger"
          props={[
            { name: "size", type: "'xs' | 'sm' | 'md' | 'lg'", default: "'lg'", description: "Trigger height / padding" },
          ]}
        />
        <DocsPropsTable
          component="SelectItem"
          props={[
            { name: "value", type: "string", description: "Option value (required)" },
            { name: "disabled", type: "boolean", description: "Non-interactive option" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Select",
  component: Select,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: SelectDocsPage } },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-[280px]">
      <Select defaultValue="opus">
        <SelectTrigger size="sm">
          <SelectValue placeholder="Choose a model" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="opus">Claude Opus</SelectItem>
          <SelectItem value="sonnet">Claude Sonnet</SelectItem>
          <SelectItem value="haiku">Claude Haiku</SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
};

export const Grouped: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-[280px]">
      <Select>
        <SelectTrigger size="sm">
          <SelectValue placeholder="Choose a model" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Anthropic</SelectLabel>
            <SelectItem value="opus">Claude Opus</SelectItem>
            <SelectItem value="sonnet">Claude Sonnet</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>OpenAI</SelectLabel>
            <SelectItem value="4o">GPT-4o</SelectItem>
            <SelectItem value="4o-mini" disabled>GPT-4o mini</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  ),
};

export const Sizes: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex w-[280px] flex-col gap-3">
      {(["xs", "sm", "md", "lg"] as const).map((s) => (
        <Select key={s} defaultValue="opus">
          <SelectTrigger size={s}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="opus">Claude Opus</SelectItem>
            <SelectItem value="sonnet">Claude Sonnet</SelectItem>
          </SelectContent>
        </Select>
      ))}
    </div>
  ),
};
