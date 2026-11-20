import * as React from "react";
import { renderToString } from "react-dom/server";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { IntegrationConnectCard, integrationConnectCommand } from "./integration-connect-card.tsx";

function installDom(): { host: HTMLElement; restore: () => void } {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const window = dom.window;
  const keys = ["window", "document", "navigator", "Node", "Element", "HTMLElement"] as const;
  const previous: Record<string, unknown> = {};
  for (const key of keys) previous[key] = (globalThis as Record<string, unknown>)[key];
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
  });
  return {
    host: window.document.getElementById("root") as unknown as HTMLElement,
    restore: () => {
      Object.assign(globalThis, previous);
      dom.window.close();
    },
  };
}

async function withMountedCard(
  card: React.ReactElement,
  run: (host: HTMLElement) => void,
): Promise<void> {
  const { host, restore } = installDom();
  const root = createRoot(host);
  try {
    flushSync(() => root.render(card));
    run(host);
  } finally {
    await unmountReactRoot(root);
    restore();
  }
}

function buttonsNamed(host: HTMLElement, name: string): HTMLButtonElement[] {
  return [...host.querySelectorAll("button")].filter((button) =>
    button.textContent?.trim() === name || button.getAttribute("aria-label") === name
  ) as HTMLButtonElement[];
}

describe("integrationConnectCommand", () => {
  it("adds --project only when a project reference is given", () => {
    assertEquals(
      integrationConnectCommand("salesforce", "proj_123"),
      "npx veryfront integration connect salesforce --project proj_123",
    );
    assertEquals(
      integrationConnectCommand("salesforce"),
      "npx veryfront integration connect salesforce",
    );
    assertEquals(
      integrationConnectCommand("salesforce", ""),
      "npx veryfront integration connect salesforce",
    );
  });
});

describe("IntegrationConnectCard", () => {
  it("names the app from the tool message and shows the command with a copy control", async () => {
    await withMountedCard(
      <IntegrationConnectCard
        integration="salesforce"
        message="Authentication required for Salesforce."
        projectReference="proj_123"
      />,
      (host) => {
        assertStringIncludes(host.textContent ?? "", "Salesforce");
        assertStringIncludes(host.textContent ?? "", "Not connected");
        assertStringIncludes(
          host.textContent ?? "",
          "npx veryfront integration connect salesforce --project proj_123",
        );
        assertEquals(buttonsNamed(host, "Copy code").length, 1);
        assertEquals(buttonsNamed(host, "Connect").length, 0);
        assertEquals(buttonsNamed(host, "Try again").length, 0);
      },
    );
  });

  it("falls back to the id in title case when the message names no app", () => {
    const withoutMessage = renderToString(<IntegrationConnectCard integration="google_calendar" />);
    assertStringIncludes(withoutMessage, "Google Calendar");

    const unrelatedMessage = renderToString(
      <IntegrationConnectCard
        integration="microsoft-teams"
        message="Teams needs to be reconnected before this tool can run."
      />,
    );
    assertStringIncludes(unrelatedMessage, "Microsoft Teams");
  });

  it("ignores an overlong app name in the message", () => {
    const html = renderToString(
      <IntegrationConnectCard
        integration="salesforce"
        message={`Authentication required for ${"x".repeat(61)}.`}
      />,
    );
    assertStringIncludes(html, "Salesforce");
    assertEquals(html.includes("x".repeat(61)), false);
  });

  it("says an expired connection is expired", () => {
    const html = renderToString(<IntegrationConnectCard integration="salesforce" reconnect />);
    assertStringIncludes(html, "Connection expired");
    assertEquals(html.includes("Not connected"), false);
  });

  it("replaces the command with a Connect button when the host can connect", async () => {
    let connects = 0;
    await withMountedCard(
      <IntegrationConnectCard integration="salesforce" onConnect={() => connects++} />,
      (host) => {
        assertEquals(host.textContent?.includes("npx veryfront integration connect"), false);
        const [connect] = buttonsNamed(host, "Connect");
        assert(connect, "Connect button");
        assertEquals(connect.type, "button");
        flushSync(() => connect.click());
        assertEquals(connects, 1);
      },
    );
  });

  it("labels the host connect action Reconnect for an expired connection", async () => {
    await withMountedCard(
      <IntegrationConnectCard integration="salesforce" reconnect onConnect={() => {}} />,
      (host) => {
        assertEquals(buttonsNamed(host, "Reconnect").length, 1);
        assertEquals(buttonsNamed(host, "Connect").length, 0);
      },
    );
  });

  it("offers Try again as a native button that runs the retry callback", async () => {
    let retries = 0;
    await withMountedCard(
      <IntegrationConnectCard integration="salesforce" onRetry={() => retries++} />,
      (host) => {
        const [retry] = buttonsNamed(host, "Try again");
        assert(retry, "Try again button");
        // A native, non-submitting button: reachable by Tab and activated by Enter or Space.
        assertEquals(retry.tagName, "BUTTON");
        assertEquals(retry.type, "button");
        assertEquals(retry.disabled, false);
        assertEquals(retry.tabIndex, 0);
        flushSync(() => retry.click());
        assertEquals(retries, 1);
      },
    );
  });

  it("forwards ref and merges className onto the card root", async () => {
    const ref = React.createRef<HTMLDivElement>();
    await withMountedCard(
      <IntegrationConnectCard ref={ref} integration="salesforce" className="host-card" />,
      (host) => {
        assert(ref.current, "ref attached");
        assertEquals(ref.current, host.firstElementChild);
        assert(ref.current.classList.contains("host-card"));
        assert(ref.current.classList.contains("rounded-[var(--radius-md)]"));
      },
    );
  });

  it("renders tool-supplied text as text, not markup", () => {
    const html = renderToString(
      <IntegrationConnectCard
        integration="salesforce"
        message="Authentication required for <img src=x onerror=alert(1)>."
      />,
    );
    assertEquals(html.includes("<img"), false);
    assertStringIncludes(html, "&lt;img");
  });
});
