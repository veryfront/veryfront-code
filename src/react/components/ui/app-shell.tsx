/**
 * AppShell — a chat-independent layout primitive modeled on the shadcn sidebar
 * (https://ui.shadcn.com/blocks). It owns the *layout + sidebar visibility*;
 * everything else is slots. The sidebar is binary — visible or hidden (no
 * collapse/icon-rail mode). Supports a left AND a right sidebar, each with its
 * own toggle and persisted state.
 *
 * Desktop: sidebars are inline flex columns (mounted only while open).
 * Mobile (< sm): sidebars become a focus-trapped off-canvas overlay + backdrop
 * that slides in from the relevant edge, with Escape-to-close, scroll-lock, and
 * focus restore.
 *
 * Renders the design-token stylesheet (`DesignTokenStyle`) so a standalone
 * `AppShell` mounted *outside* `<Chat>` still resolves its `[var(--token)]`
 * utilities. Fully self-contained within `veryfront/ui`: uses the local `cn`,
 * `ui/button`, and `ui/tokens` — no imports back into `chat/`.
 *
 * @module react/components/ui/app-shell
 */
import * as React from "react";
import { createStrictContext } from "../create-strict-context.ts";
import { cx as cn } from "./cva.ts";
import { DesignTokenStyle } from "./tokens.tsx";
import { UI_SCOPE_ATTRS } from "./design-tokens.ts";
import { PanelLeftIcon, PanelRightIcon } from "./icons/index.ts";
import { Button, type ButtonProps } from "./button.tsx";

/** Which edge a sidebar docks to. */
export type AppShellSide = "left" | "right";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DocumentScrollLock {
  count: number;
  previousOverflow: string;
}

const documentScrollLocks = new WeakMap<Document, DocumentScrollLock>();

/**
 * Lock one document's body until every AppShell overlay using it has released
 * ownership. The final release restores the exact value from before the first
 * lock, independent of overlay mount/unmount order.
 */
function acquireDocumentScrollLock(ownerDocument: Document): () => void {
  const existing = documentScrollLocks.get(ownerDocument);
  if (existing) {
    existing.count += 1;
  } else {
    documentScrollLocks.set(ownerDocument, {
      count: 1,
      previousOverflow: ownerDocument.body.style.overflow,
    });
  }
  ownerDocument.body.style.overflow = "hidden";

  let released = false;
  return () => {
    if (released) return;
    released = true;

    const current = documentScrollLocks.get(ownerDocument);
    if (!current) return;
    current.count -= 1;
    if (current.count > 0) return;

    ownerDocument.body.style.overflow = current.previousOverflow;
    documentScrollLocks.delete(ownerDocument);
  };
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  const element = target as Element | null;
  if (!element || typeof element.closest !== "function") return false;
  if (element.closest("input, textarea, select")) return true;

  const contentEditableRoot = element.closest("[contenteditable]");
  return contentEditableRoot !== null &&
    contentEditableRoot.getAttribute("contenteditable")?.toLowerCase() !== "false";
}

function assignRef<T>(
  ref: React.Ref<T> | undefined,
  value: T | null,
): (() => void) | undefined {
  if (typeof ref === "function") {
    const cleanup = ref(value);
    return typeof cleanup === "function" ? cleanup : undefined;
  }
  if (ref) ref.current = value;
  return undefined;
}

interface AppShellContextValue {
  /** Viewport is below the `sm` breakpoint (< 640px). */
  isMobile: boolean;
  /** Effective visibility of a side for the current viewport. */
  isOpen: (side: AppShellSide) => boolean;
  /** Flip a side's visibility. */
  toggle: (side: AppShellSide) => void;
  /** Set a side's visibility explicitly. */
  setOpen: (side: AppShellSide, open: boolean) => void;
  /** Stable DOM id for a side's sidebar (for `aria-controls`). */
  sidebarId: (side: AppShellSide) => string;
}

const [AppShellContext, useAppShell] = createStrictContext<AppShellContextValue>(
  "AppShell parts",
  "<AppShell>",
);
/** Access the enclosing {@link AppShell}'s state (external triggers, etc.). */
export { useAppShell };

/** Reactive `< sm` viewport check (matches Tailwind `max-sm`). SSR-safe. */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const mql = globalThis.matchMedia("(max-width: 639.98px)");
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return isMobile;
}

function readStored(
  storageKey: string | undefined,
  side: AppShellSide,
  fallback: boolean,
): boolean {
  if (!storageKey || typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(`${storageKey}-${side}`);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch (_) { /* expected: unavailable/blocked storage */ }
  return fallback;
}

function writeStored(
  storageKey: string | undefined,
  side: AppShellSide,
  value: boolean,
): void {
  if (!storageKey || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(`${storageKey}-${side}`, String(value));
  } catch (_) { /* expected: unavailable/blocked storage */ }
}

/** Per-side visibility map. */
export interface AppShellOpenState {
  left?: boolean;
  right?: boolean;
}

/** Props accepted by {@link AppShell}. */
export interface AppShellProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Controlled desktop visibility per side. Omit a side to leave it uncontrolled. */
  open?: AppShellOpenState;
  /** Uncontrolled initial desktop visibility. Defaults: left `true`, right `false`. */
  defaultOpen?: AppShellOpenState;
  /** Fires when a side is toggled (desktop). Receives the requested next value. */
  onOpenChange?: (side: AppShellSide, open: boolean) => void;
  /** localStorage key prefix for persisting uncontrolled desktop visibility. */
  storageKey?: string;
  /** Toggle the left sidebar with ⌘/Ctrl+B. Default `true`. */
  keyboardShortcut?: boolean;
  ref?: React.Ref<HTMLDivElement>;
}

/** Root — provides sidebar state and the flex layout container. */
function AppShellRoot({
  open,
  defaultOpen,
  onOpenChange,
  storageKey,
  keyboardShortcut = true,
  className,
  children,
  ref,
  ...props
}: AppShellProps): React.ReactElement {
  const isMobile = useIsMobile();
  const baseId = React.useId();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const mergedRootRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      const cleanupExternalRef = assignRef(ref, node);
      return () => {
        rootRef.current = null;
        if (cleanupExternalRef) cleanupExternalRef();
        else assignRef(ref, null);
      };
    },
    [ref],
  );

  const isControlledLeft = open?.left !== undefined;
  const isControlledRight = open?.right !== undefined;

  // The first client render must match SSR. Reading browser-only persistence in
  // the state initializer removes a server-rendered sidebar during hydration
  // and forces React to discard that subtree. Reconcile storage after mount.
  const initialDesktopOpen = React.useRef({
    left: defaultOpen?.left ?? true,
    right: defaultOpen?.right ?? false,
  });
  const [leftDesktop, setLeftDesktop] = React.useState(initialDesktopOpen.current.left);
  const [rightDesktop, setRightDesktop] = React.useState(initialDesktopOpen.current.right);
  const [leftMobile, setLeftMobile] = React.useState(false);
  const [rightMobile, setRightMobile] = React.useState(false);

  React.useEffect(() => {
    if (!isControlledLeft) {
      setLeftDesktop(readStored(storageKey, "left", initialDesktopOpen.current.left));
    }
    if (!isControlledRight) {
      setRightDesktop(readStored(storageKey, "right", initialDesktopOpen.current.right));
    }
  }, [storageKey, isControlledLeft, isControlledRight]);

  // Returning to a wider viewport drops any open mobile overlays.
  React.useEffect(() => {
    if (!isMobile) {
      setLeftMobile(false);
      setRightMobile(false);
    }
  }, [isMobile]);

  const desktopOpen: Record<AppShellSide, boolean> = {
    left: isControlledLeft ? open!.left! : leftDesktop,
    right: isControlledRight ? open!.right! : rightDesktop,
  };
  const mobileOpen: Record<AppShellSide, boolean> = {
    left: leftMobile,
    right: rightMobile,
  };

  const setOpen = React.useCallback(
    (side: AppShellSide, value: boolean) => {
      if (isMobile) {
        (side === "left" ? setLeftMobile : setRightMobile)(value);
        return;
      }
      const controlled = side === "left" ? isControlledLeft : isControlledRight;
      if (!controlled) {
        (side === "left" ? setLeftDesktop : setRightDesktop)(value);
        writeStored(storageKey, side, value);
      }
      onOpenChange?.(side, value);
    },
    [isMobile, isControlledLeft, isControlledRight, storageKey, onOpenChange],
  );

  const value = React.useMemo<AppShellContextValue>(() => {
    const isOpen = (side: AppShellSide) => isMobile ? mobileOpen[side] : desktopOpen[side];
    return {
      isMobile,
      isOpen,
      setOpen,
      toggle: (side) => setOpen(side, !isOpen(side)),
      sidebarId: (side) => `${baseId}-sidebar-${side}`,
    };
    // Intentional: list the individual open fields rather than desktopOpen/mobileOpen
    // objects. The objects are re-created on every render (derived from state), so
    // listing them would make `value` a new reference every render and cause all
    // consumers to re-render unnecessarily. Listing the primitive fields means the
    // memo only invalidates when sidebar visibility or the viewport mode actually
    // changes. Do not "fix" this to `[isMobile, setOpen, baseId, desktopOpen, mobileOpen]`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isMobile,
    setOpen,
    baseId,
    desktopOpen.left,
    desktopOpen.right,
    mobileOpen.left,
    mobileOpen.right,
  ]);

  // ⌘/Ctrl+B toggles the left sidebar (shadcn parity).
  React.useEffect(() => {
    if (!keyboardShortcut) return;
    const ownerDocument = rootRef.current?.ownerDocument;
    if (!ownerDocument) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.key !== "b" && e.key !== "B")) return;
      if (e.defaultPrevented || isEditableKeyboardTarget(e.target)) return;

      e.preventDefault();
      value.toggle("left");
    };
    ownerDocument.addEventListener("keydown", onKeyDown);
    return () => ownerDocument.removeEventListener("keydown", onKeyDown);
  }, [keyboardShortcut, value]);

  return (
    <AppShellContext.Provider value={value}>
      <DesignTokenStyle />
      <div
        {...props}
        ref={mergedRootRef}
        className={cn("flex h-full w-full", className)}
        data-vf-appshell=""
        {...UI_SCOPE_ATTRS}
      >
        {children}
      </div>
    </AppShellContext.Provider>
  );
}

/** Props accepted by {@link AppShellSidebar}. */
export interface AppShellSidebarProps extends React.HTMLAttributes<HTMLElement> {
  /** Edge to dock to. Default `left`. */
  side?: AppShellSide;
  /** Sidebar width in px (desktop column + mobile overlay panel). Default `240`. */
  width?: number;
}

/** Focus-trapped off-canvas overlay used on mobile. */
function SidebarOverlay({
  side,
  width,
  id,
  className,
  children,
  style,
  "aria-label": ariaLabel,
  ...props
}: AppShellSidebarProps & { id: string }): React.ReactElement {
  const ctx = useAppShell();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [entered, setEntered] = React.useState(false);

  // Refs so the keydown handler always reads the latest ctx/side without
  // being recreated on every render (which would tear down and re-register
  // the focus trap on each parent re-render).
  const ctxRef = React.useRef(ctx);
  ctxRef.current = ctx;
  const sideRef = React.useRef(side);
  sideRef.current = side;

  React.useEffect(() => {
    const panel = panelRef.current;
    const ownerDocument = panel?.ownerDocument ?? document;
    const previouslyFocused = ownerDocument.activeElement as HTMLElement | null;
    const releaseScrollLock = acquireDocumentScrollLock(ownerDocument);

    const raf = requestAnimationFrame(() => setEntered(true));
    const focusables = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
    (focusables()[0] ?? panel)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        ctxRef.current.setOpen(sideRef.current ?? "left", false);
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusables();
      const first = els[0];
      const last = els[els.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey && ownerDocument.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && ownerDocument.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    ownerDocument.addEventListener("keydown", onKeyDown);

    return () => {
      ownerDocument.removeEventListener("keydown", onKeyDown);
      releaseScrollLock();
      cancelAnimationFrame(raf);
      previouslyFocused?.focus?.();
    };
  }, []);

  const hiddenTransform = side === "right" ? "translateX(100%)" : "translateX(-100%)";

  return (
    <div className="fixed inset-0 z-50 sm:hidden">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[var(--overlay)] transition-opacity duration-200 motion-reduce:transition-none"
        style={{ opacity: entered ? 1 : 0 }}
        onClick={() => ctx.setOpen(side ?? "left", false)}
      />
      <aside
        {...props}
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? "Sidebar"}
        tabIndex={-1}
        className={cn(
          "absolute inset-y-0 z-50 flex h-full flex-col bg-[var(--background)] shadow-xl outline-none",
          "transition-transform duration-200 ease-out motion-reduce:transition-none",
          side === "right" ? "right-0" : "left-0",
          className,
        )}
        style={{
          ...style,
          width,
          transform: entered ? "translateX(0)" : hiddenTransform,
        }}
      >
        {children}
      </aside>
    </div>
  );
}

/** A dockable sidebar. Renders inline on desktop, as an overlay on mobile. */
function AppShellSidebar({
  side = "left",
  width = 240,
  className,
  children,
  style,
  "aria-label": ariaLabel,
  ...props
}: AppShellSidebarProps): React.ReactElement | null {
  const ctx = useAppShell();
  const id = ctx.sidebarId(side);
  if (!ctx.isOpen(side)) return null;

  if (ctx.isMobile) {
    return (
      <SidebarOverlay
        {...props}
        side={side}
        width={width}
        id={id}
        className={className}
        style={style}
        aria-label={ariaLabel}
      >
        {children}
      </SidebarOverlay>
    );
  }

  return (
    <aside
      {...props}
      id={id}
      aria-label={ariaLabel ?? "Sidebar"}
      className={cn("flex h-full shrink-0 flex-col", className)}
      style={{ ...style, width }}
    >
      {children}
    </aside>
  );
}

/** Optional border-carrying section. */
interface BorderedProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Draw a divider on the section's inner edge. Default `false`. */
  border?: boolean;
}

/** Sidebar header slot — optional bottom border. */
function AppShellSidebarHeader({
  border = false,
  className,
  ...props
}: BorderedProps): React.ReactElement {
  return (
    <div
      className={cn(
        "shrink-0",
        border && "border-b border-[var(--outline-border)]",
        className,
      )}
      {...props}
    />
  );
}

/** Sidebar scroll region — grows to fill and scrolls. */
function AppShellSidebarContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto", className)} {...props} />;
}

/** Sidebar footer slot — optional top border. */
function AppShellSidebarFooter({
  border = false,
  className,
  ...props
}: BorderedProps): React.ReactElement {
  return (
    <div
      className={cn(
        "shrink-0",
        border && "border-t border-[var(--outline-border)]",
        className,
      )}
      {...props}
    />
  );
}

/** The main content column, between/beside the sidebars. */
function AppShellMain({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn("flex min-w-0 flex-1 flex-col", className)}
      {...props}
    />
  );
}

/** Props accepted by {@link AppShellHeader}. */
export interface AppShellHeaderProps extends React.HTMLAttributes<HTMLElement> {
  /** Draw a bottom divider. Default `false`. */
  border?: boolean;
}

/** Optional top bar inside the main column — with or without a bottom border. */
function AppShellHeader({
  border = false,
  className,
  ...props
}: AppShellHeaderProps): React.ReactElement {
  return (
    <header
      className={cn(
        "flex shrink-0 items-center gap-1 px-3 py-2",
        border && "border-b border-[var(--outline-border)]",
        className,
      )}
      {...props}
    />
  );
}

/** The main content region — grows to fill, host owns overflow. */
function AppShellContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn("min-h-0 flex-1", className)} {...props} />;
}

/** Props accepted by {@link AppShellTrigger}. */
export interface AppShellTriggerProps extends ButtonProps {
  /** Which sidebar to toggle. Default `left`. */
  side?: AppShellSide;
  /** Override the default panel icon (`PanelLeft` / `PanelRight`). */
  icon?: React.ReactNode;
}

/** Toggle button — built on the shared `Button`, defaults its icon by `side`. */
function AppShellTrigger({
  side = "left",
  icon,
  variant = "icon-ghost",
  size = "icon-default",
  className,
  onClick,
  "aria-label": ariaLabel,
  ...props
}: AppShellTriggerProps): React.ReactElement {
  const ctx = useAppShell();
  const open = ctx.isOpen(side);
  const defaultIcon = side === "right"
    ? <PanelRightIcon className="size-[18px]" />
    : <PanelLeftIcon className="size-[18px]" />;

  return (
    <Button
      {...props}
      variant={variant}
      size={size}
      className={className}
      aria-expanded={open}
      aria-controls={ctx.sidebarId(side)}
      aria-label={ariaLabel ??
        `${open ? "Close" : "Open"} ${side} sidebar`}
      onClick={(e) => {
        onClick?.(e);
        ctx.toggle(side);
      }}
    >
      {icon ?? defaultIcon}
    </Button>
  );
}

/**
 * Compound AppShell. Compose:
 *
 * ```tsx
 * <AppShell storageKey="vf-shell">
 *   <AppShell.Sidebar side="left">
 *     <AppShell.SidebarHeader border>…</AppShell.SidebarHeader>
 *     <AppShell.SidebarContent>…</AppShell.SidebarContent>
 *   </AppShell.Sidebar>
 *   <AppShell.Main>
 *     <AppShell.Header border>
 *       <AppShell.Trigger side="left" />
 *     </AppShell.Header>
 *     <AppShell.Content>…</AppShell.Content>
 *   </AppShell.Main>
 *   <AppShell.Sidebar side="right">…</AppShell.Sidebar>
 * </AppShell>
 * ```
 */
export const AppShell: typeof AppShellRoot & {
  Sidebar: typeof AppShellSidebar;
  SidebarHeader: typeof AppShellSidebarHeader;
  SidebarContent: typeof AppShellSidebarContent;
  SidebarFooter: typeof AppShellSidebarFooter;
  Main: typeof AppShellMain;
  Header: typeof AppShellHeader;
  Content: typeof AppShellContent;
  Trigger: typeof AppShellTrigger;
} = Object.assign(AppShellRoot, {
  Sidebar: AppShellSidebar,
  SidebarHeader: AppShellSidebarHeader,
  SidebarContent: AppShellSidebarContent,
  SidebarFooter: AppShellSidebarFooter,
  Main: AppShellMain,
  Header: AppShellHeader,
  Content: AppShellContent,
  Trigger: AppShellTrigger,
});

AppShellRoot.displayName = "AppShell";
AppShellSidebar.displayName = "AppShell.Sidebar";
AppShellSidebarHeader.displayName = "AppShell.SidebarHeader";
AppShellSidebarContent.displayName = "AppShell.SidebarContent";
AppShellSidebarFooter.displayName = "AppShell.SidebarFooter";
AppShellMain.displayName = "AppShell.Main";
AppShellHeader.displayName = "AppShell.Header";
AppShellContent.displayName = "AppShell.Content";
AppShellTrigger.displayName = "AppShell.Trigger";
