// Consumer fixture — documented `veryfront/ui` composition.
//
// This file is never executed; it exists so the consumer `tsc --noEmit` gate
// (scripts/typecheck/tsconfig.consumer.json) proves the public UI primitives
// compose under React-19 `@types/react` exactly as an external app would import
// and use them. It intentionally imports via the published `veryfront/ui`
// specifier (not a relative src path) and exercises `children`, per-part slots,
// and compound sub-components — the surface the (non-reproducing) "G1 children"
// concern was really about.
import * as React from "react";
import {
  Alert,
  AlertAction,
  AlertContent,
  AlertIcon,
  AppShell,
  Button,
  Card,
  CardContent,
  CardHeader,
  useAppShell,
} from "veryfront/ui";

/** AppShell compound — full documented tree, children flowing through every slot. */
export function ShellDemo(): React.ReactElement {
  return (
    <AppShell storageKey="vf-consumer-fixture">
      <AppShell.Sidebar side="left">
        <AppShell.SidebarHeader border>Header</AppShell.SidebarHeader>
        <AppShell.SidebarContent>
          <nav>items</nav>
        </AppShell.SidebarContent>
        <AppShell.SidebarFooter border>Footer</AppShell.SidebarFooter>
      </AppShell.Sidebar>
      <AppShell.Main>
        <AppShell.Header border>
          <AppShell.Trigger side="left" />
        </AppShell.Header>
        <AppShell.Content>
          <div>body</div>
        </AppShell.Content>
      </AppShell.Main>
    </AppShell>
  );
}

/** A part reads shell state from context — no prop-drill. */
export function ShellStatus(): React.ReactElement {
  const { isMobile, toggle } = useAppShell();
  return (
    <Button onClick={() => toggle("left")}>
      {isMobile ? "mobile" : "desktop"}
    </Button>
  );
}

/** Alert compound + Card — each visual leaf individually addressable. */
export function CardsDemo(): React.ReactElement {
  return (
    <Card>
      <CardHeader>Title</CardHeader>
      <CardContent>
        <Alert>
          <AlertIcon />
          <AlertContent>Message body</AlertContent>
          <AlertAction>
            <Button variant="ghost">Dismiss</Button>
          </AlertAction>
        </Alert>
      </CardContent>
    </Card>
  );
}
