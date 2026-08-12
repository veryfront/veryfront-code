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
  Autocomplete,
  AutocompleteContent,
  AutocompleteInput,
  AutocompleteItem,
} from "../../../src/react/components/ui/index.ts";

const importCode =
  `import { Autocomplete, AutocompleteInput, AutocompleteContent, AutocompleteItem } from "veryfront/ui"`;

const CITIES = ["Amsterdam", "Berlin", "Barcelona", "Copenhagen", "Lisbon", "Madrid", "Paris"];

function AutocompleteDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Autocomplete"
        lead="A free-text input with a suggestions dropdown — the value is whatever you type."
      />

      <DocsSection
        title="Default"
        description="Type freely; suggestions filter as you go and fill the input when chosen."
      >
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection
        title="Free text vs Combobox"
        description="Unlike Combobox, the value is not forced to a listed option — you can submit text that isn't a suggestion."
      >
        <DocsExampleAuto of={FreeText} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>
          {"Autocomplete > AutocompleteInput + AutocompleteContent > AutocompleteItem"}
        </DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Autocomplete"
          description="Free-text input with suggestions"
          props={[
            {
              name: "defaultValue",
              type: "string",
              description: "Initial input text when uncontrolled",
            },
            {
              name: "onValueChange",
              type: "(value: string) => void",
              description: "Fires with the current text — typing or choosing a suggestion",
            },
            {
              name: "open",
              type: "boolean",
              description: "Controlled open state of the suggestions list",
            },
            {
              name: "onOpenChange",
              type: "(open: boolean) => void",
              description: "Fires when the suggestions open or close",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/Autocomplete",
  component: Autocomplete,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: AutocompleteDocsPage },
  },
} satisfies Meta<typeof Autocomplete>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-64">
      <Autocomplete>
        <AutocompleteInput placeholder="Search cities…" />
        <AutocompleteContent>
          {CITIES.map((c) => <AutocompleteItem key={c} value={c} />)}
        </AutocompleteContent>
      </Autocomplete>
    </div>
  ),
};

export const FreeText: Story = {
  name: "Free text vs Combobox",
  tags: ["!dev"],
  render: () => {
    const [value, setValue] = useState("");
    return (
      <div className="w-64">
        <Autocomplete onValueChange={setValue}>
          <AutocompleteInput placeholder="Type anything…" />
          <AutocompleteContent>
            {CITIES.map((c) => <AutocompleteItem key={c} value={c} />)}
          </AutocompleteContent>
        </Autocomplete>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">value: {value || "—"}</p>
      </div>
    );
  },
};
