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
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
} from "../../../src/react/components/ui/index.ts";

const importCode =
  `import { Combobox, ComboboxInput, ComboboxContent, ComboboxItem } from "veryfront/ui"`;

const FRAMEWORKS = [
  { value: "next", label: "Next.js" },
  { value: "remix", label: "Remix" },
  { value: "astro", label: "Astro" },
  { value: "sveltekit", label: "SvelteKit" },
  { value: "nuxt", label: "Nuxt" },
];

function ComboboxDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Combobox"
        lead="A text input that filters a listbox as you type, then commits a selection."
      />

      <DocsSection title="Default" description="Type to filter; ↑/↓ to move, Enter to select, Esc to close.">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="Controlled" description="Drive the selected value with value + onValueChange.">
        <DocsExampleAuto of={Controlled} />
      </DocsSection>

      <DocsSection title="Swap the engine" description="Wrap in UIAdapterProvider to run on cmdk / Base UI - the call site is unchanged.">
        <DocsCode
          code={`<UIAdapterProvider adapter={{ combobox: cmdkCombobox }}>
  <Combobox>…</Combobox>
</UIAdapterProvider>`}
        />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>
          {"Combobox > ComboboxInput + ComboboxContent > ComboboxItem"}
        </DocsComposition>
      </DocsSection>

      <DocsSection title="API reference">
        <DocsPropsTable
          component="Combobox"
          description="Filterable select with a text input"
          props={[
            {
              name: "value",
              type: "string",
              description: "Controlled selected value (pair with onValueChange)",
            },
            {
              name: "defaultValue",
              type: "string",
              description: "Initial selected value when uncontrolled",
            },
            {
              name: "onValueChange",
              type: "(value: string) => void",
              description: "Fires with the newly-selected value",
            },
            {
              name: "open",
              type: "boolean",
              description: "Controlled listbox open state",
            },
            {
              name: "defaultInputValue",
              type: "string",
              description: "Initial input text",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/Combobox",
  component: Combobox,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: ComboboxDocsPage },
  },
} satisfies Meta<typeof Combobox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-64">
      <Combobox>
        <ComboboxInput placeholder="Search framework…" />
        <ComboboxContent>
          {FRAMEWORKS.map((f) => (
            <ComboboxItem key={f.value} value={f.value} textValue={f.label}>
              {f.label}
            </ComboboxItem>
          ))}
        </ComboboxContent>
      </Combobox>
    </div>
  ),
};

export const Controlled: Story = {
  tags: ["!dev"],
  render: () => {
    const [value, setValue] = useState<string>("astro");
    return (
      <div className="w-64">
        <Combobox value={value} onValueChange={setValue}>
          <ComboboxInput placeholder="Search framework…" />
          <ComboboxContent>
            {FRAMEWORKS.map((f) => (
              <ComboboxItem key={f.value} value={f.value} textValue={f.label}>
                {f.label}
              </ComboboxItem>
            ))}
          </ComboboxContent>
        </Combobox>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">selected: {value}</p>
      </div>
    );
  },
};
