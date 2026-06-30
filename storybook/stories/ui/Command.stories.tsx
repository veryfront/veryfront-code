import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandItemContent,
  CommandItemDescription,
  CommandItemTitle,
  CommandList,
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
  Command, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandItemContent,
  CommandItemTitle, CommandItemDescription,
} from "veryfront/chat/ui"`;

const compositionTree =
  `Command              <- owns the filter query + item registry
  +-- CommandInput       <- search box (filters the list)
  +-- CommandList        <- scroll container
       +-- CommandEmpty      <- shown when nothing matches
       +-- CommandGroup      <- heading + items (auto-hides when empty)
            +-- CommandItem      <- filterable row, onSelect
                 +-- CommandItemContent / Title / Description`;

const models = [
  { provider: "Anthropic", items: [
    { value: "claude opus", name: "Claude Opus", cap: "Most capable" },
    { value: "claude sonnet", name: "Claude Sonnet", cap: "Balanced" },
    { value: "claude haiku", name: "Claude Haiku", cap: "Fastest" },
  ] },
  { provider: "OpenAI", items: [
    { value: "gpt-4o", name: "GPT-4o", cap: "Multimodal" },
    { value: "gpt-4o mini", name: "GPT-4o mini", cap: "Lightweight" },
  ] },
];

function CommandDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Command"
        lead="A searchable, filtered list — the model picker (Popover + Command, `Search models…`). Type to filter; empty groups auto-hide. Basic substring matching; arrow-key nav is TODO."
      />
      <DocsSection
        title="Model picker"
        description="Type to filter across providers."
      >
        <DocsExampleAuto of={ModelPicker} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>
      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="CommandItem"
          props={[
            { name: "value", type: "string", description: "Searchable text used for filtering" },
            { name: "onSelect", type: "(value) => void", description: "Chosen handler" },
            { name: "align", type: "'center' | 'start'", default: "'center'", description: "Top-align icon for two-line items" },
          ]}
        />
        <DocsPropsTable
          component="CommandGroup"
          props={[
            { name: "heading", type: "ReactNode", description: "Group label (auto-hides when all items filtered out)" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Command",
  component: Command,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: CommandDocsPage } },
} satisfies Meta<typeof Command>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ModelPicker: Story = {
  tags: ["!dev"],
  render: () => (
    <Command className="w-[320px] shadow-sm">
      <CommandInput placeholder="Search models…" />
      <CommandList>
        <CommandEmpty>No models found.</CommandEmpty>
        {models.map((group) => (
          <CommandGroup key={group.provider} heading={group.provider}>
            {group.items.map((m) => (
              <CommandItem key={m.value} value={m.value} align="start">
                <CommandItemContent>
                  <CommandItemTitle>{m.name}</CommandItemTitle>
                  <CommandItemDescription>{m.cap}</CommandItemDescription>
                </CommandItemContent>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  ),
};
