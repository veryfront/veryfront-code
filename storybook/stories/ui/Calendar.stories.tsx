import * as React from "react";
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
import { Calendar } from "../../../src/react/components/ui/index.ts";

const importCode = `import { Calendar } from "veryfront/ui"`;

const compositionTree = `Calendar
├─ header (‹ · Month YYYY · ›)
├─ weekday row (Su Mo Tu We Th Fr Sa)
└─ grid (weeks of day buttons)`;

function CalendarDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Calendar"
        lead="A dependency-free single-month date grid: pick a day, page between months."
      />

      <DocsSection
        title="Controlled"
        description="Hold the selected Date in state and pass it back as value; onChange fires with the clicked day."
      >
        <DocsExampleAuto of={Controlled} />
      </DocsSection>

      <DocsSection
        title="Static month"
        description="Show a fixed month with a preselected day via defaultMonth and value."
      >
        <DocsExampleAuto of={StaticMonth} />
      </DocsSection>

      <DocsSection
        title="Monday start"
        description="Set weekStartsOn={1} to start the week on Monday."
      >
        <DocsExampleAuto of={MondayStart} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Calendar"
          description="Single-month date grid"
          props={[
            {
              name: "value",
              type: "Date",
              description: "The selected day (controlled)",
            },
            {
              name: "onChange",
              type: "(date: Date) => void",
              description: "Fires with the clicked day",
            },
            {
              name: "defaultMonth",
              type: "Date",
              default: "value ?? today",
              description: "Month shown initially; moved internally by the prev/next buttons",
            },
            {
              name: "weekStartsOn",
              type: "0 | 1",
              default: "0",
              description: "First day of the week: 0 = Sunday, 1 = Monday",
            },
            {
              name: "className",
              type: "string",
              description: "Additional classes",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/Calendar",
  component: Calendar,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: CalendarDocsPage },
  },
} satisfies Meta<typeof Calendar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Controlled: Story = {
  tags: ["!dev"],
  render: () => {
    const [day, setDay] = React.useState<Date | undefined>(new Date(2026, 0, 15));
    return (
      <div className="flex flex-col items-center gap-3">
        <Calendar value={day} defaultMonth={new Date(2026, 0, 1)} onChange={setDay} />
        <p className="text-sm text-[var(--muted-foreground)]">
          Selected: {day ? day.toDateString() : "none"}
        </p>
      </div>
    );
  },
};

export const StaticMonth: Story = {
  tags: ["!dev"],
  render: () => (
    <Calendar value={new Date(2026, 0, 15)} defaultMonth={new Date(2026, 0, 1)} />
  ),
};

export const MondayStart: Story = {
  tags: ["!dev"],
  render: () => (
    <Calendar
      value={new Date(2026, 0, 15)}
      defaultMonth={new Date(2026, 0, 1)}
      weekStartsOn={1}
    />
  ),
};
