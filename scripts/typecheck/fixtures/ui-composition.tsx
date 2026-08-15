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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  type ContextMenuItemProps,
  ContextMenuTrigger,
  type ContextMenuTriggerProps,
  DrawerContent,
  type DrawerContentProps,
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

/** Drawer content keeps its public prop type aligned with the component surface. */
export function DrawerContentPublicPropsDemo(): React.ReactElement {
  const ref = React.createRef<HTMLDivElement>();
  const props: DrawerContentProps = {
    ref,
    className: "vf-consumer-drawer",
    children: "Drawer body",
  };
  return <DrawerContent {...props} />;
}

const contextMenuTriggerRef = React.createRef<HTMLAnchorElement>();
const contextMenuItemRef = React.createRef<HTMLAnchorElement>();
const conditionalContextMenuSlot: boolean = true;

interface ConsumerContextMenuTriggerProps extends ContextMenuTriggerProps {
  analyticsId?: string;
}

interface ConsumerContextMenuItemProps extends ContextMenuItemProps {
  analyticsId?: string;
}

const compatibleContextMenuTriggerProps: ContextMenuTriggerProps = {
  asChild: conditionalContextMenuSlot,
};
const compatibleContextMenuItemProps: ContextMenuItemProps = {
  asChild: conditionalContextMenuSlot,
};

/** Existing wrappers keep the broad boolean ContextMenu contracts. */
export function ConsumerContextMenuTrigger({
  analyticsId,
  ...props
}: ConsumerContextMenuTriggerProps): React.ReactElement {
  return <ContextMenuTrigger {...props} data-analytics-id={analyticsId} />;
}

export function ConsumerContextMenuItem({
  analyticsId,
  ...props
}: ConsumerContextMenuItemProps): React.ReactElement {
  return <ContextMenuItem {...props} data-analytics-id={analyticsId} />;
}

/** Literal ContextMenu slots expose refs and events for the rendered anchor. */
export function ContextMenuSlottedRefsDemo(): React.ReactElement {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        ref={contextMenuTriggerRef}
        onContextMenu={(event) => event.currentTarget.href}
      >
        <a href="#context-menu">Open context menu</a>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ConsumerContextMenuItem {...compatibleContextMenuItemProps}>
          Conditional item
        </ConsumerContextMenuItem>
        <ContextMenuItem
          asChild
          ref={contextMenuItemRef}
          onClick={(event) => event.currentTarget.href}
        >
          <a href="#archive">Archive</a>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

void compatibleContextMenuTriggerProps;
