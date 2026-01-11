/**
 * Integration loader for service connectors
 *
 * Loads integrations from the integrations/ directory and handles:
 * - Integration file overlay
 * - OAuth configuration
 * - Tool auto-discovery
 * - Prompt/action loading
 */

import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import * as pathHelper from "@veryfront/platform/compat/path-helper.ts";
import { loadTemplateFromDirectory } from "./loader.ts";
import type {
  IntegrationConfig,
  IntegrationName,
  ResolvedIntegration,
  TemplateFile,
  UseCaseConfig,
  UseCaseName,
} from "./types.ts";

/**
 * Available integrations that can be added via --integrations flag
 */
export const AVAILABLE_INTEGRATIONS: IntegrationName[] = [
  "gmail",
  "slack",
  "github",
  "calendar",
  "jira",
  "notion",
  "servicenow",
  "confluence",
  "linear",
  "gitlab",
  "outlook",
  "teams",
  "figma",
  "sheets",
  "airtable",
  "supabase",
  "neon",
  "sharepoint",
  "discord",
  "hubspot",
  "stripe",
  "dropbox",
  "salesforce",
  "twitter",
  "onedrive",
  "bitbucket",
  "sentry",
  "posthog",
  "zendesk",
  // New integrations
  "asana",
  "monday",
  "zoom",
  "trello",
  "box",
  "shopify",
  "clickup",
  "intercom",
  "pipedrive",
  "mailchimp",
  "webex",
  "freshdesk",
  "quickbooks",
  "xero",
  // 50+ integrations
  "drive",
  "docs-google",
  "snowflake",
  "mixpanel",
  "twilio",
  "anthropic",
  "aws",
];

/**
 * Available use-cases that can be selected via --usecase flag
 */
export const AVAILABLE_USECASES: UseCaseName[] = [
  "productivity",
  "developer",
  "support",
  "social",
  "custom",
];

/**
 * Pre-defined use-case configurations
 */
export const USE_CASE_CONFIGS: Record<UseCaseName, UseCaseConfig> = {
  productivity: {
    name: "productivity",
    displayName: "Personal Productivity",
    description: "Email, calendar, and team communication management",
    integrations: ["gmail", "slack", "calendar"],
    defaultPrompts: [
      "summarize-emails",
      "catch-up-slack",
      "block-deep-work",
    ],
    chatUI: "full-page",
    icon: "productivity",
  },
  developer: {
    name: "developer",
    displayName: "Developer Tools",
    description: "Code review, issue tracking, and team updates",
    integrations: ["github", "jira", "slack"],
    defaultPrompts: [
      "review-prs",
      "create-ticket",
      "update-team",
    ],
    chatUI: "sidebar",
    icon: "code",
  },
  support: {
    name: "support",
    displayName: "Customer Support",
    description: "Ticket management, knowledge base, and escalation",
    integrations: ["servicenow", "slack", "notion"],
    defaultPrompts: [
      "check-ticket-status",
      "search-kb",
      "escalate-issue",
    ],
    chatUI: "widget",
    icon: "support",
  },
  social: {
    name: "social",
    displayName: "Social Media",
    description: "Content scheduling, posting, and monitoring",
    integrations: ["slack", "notion", "calendar"],
    defaultPrompts: [
      "draft-content",
      "schedule-content",
      "monitor-channels",
    ],
    chatUI: "cards",
    icon: "social",
  },
  custom: {
    name: "custom",
    displayName: "Custom",
    description: "Build your own agent with custom integrations",
    integrations: [],
    defaultPrompts: [],
    chatUI: "full-page",
    icon: "settings",
  },
};

/**
 * Get the directory path for an integration
 */
export function getIntegrationDirectory(integrationName: string): string {
  const moduleUrl = new URL(".", import.meta.url);
  let moduleDir: string;

  if (moduleUrl.protocol === "file:") {
    moduleDir = moduleUrl.pathname;
    if (
      typeof process !== "undefined" &&
      process.platform === "win32" &&
      moduleDir.startsWith("/")
    ) {
      moduleDir = moduleDir.slice(1);
    }
  } else {
    moduleDir = moduleUrl.href;
  }

  return pathHelper.join(moduleDir, "integrations", integrationName);
}

/**
 * Load integration configuration from connector.json
 */
export async function loadIntegrationConfig(
  integrationName: IntegrationName,
): Promise<IntegrationConfig | null> {
  const fs = createFileSystem();
  const integrationDir = getIntegrationDirectory(integrationName);
  const configPath = pathHelper.join(integrationDir, "connector.json");

  try {
    const content = await fs.readTextFile(configPath);
    return JSON.parse(content) as IntegrationConfig;
  } catch {
    return null;
  }
}

/**
 * Load an integration with its files
 */
export async function loadIntegration(
  integrationName: IntegrationName,
): Promise<ResolvedIntegration | null> {
  const config = await loadIntegrationConfig(integrationName);
  if (!config) {
    return null;
  }

  const integrationDir = getIntegrationDirectory(integrationName);
  const filesDir = pathHelper.join(integrationDir, "files");

  // Load integration files
  const files = await loadTemplateFromDirectory(filesDir);

  return {
    config,
    files,
  };
}

/**
 * Validate integration names
 */
export function validateIntegrations(integrations: IntegrationName[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  for (const integration of integrations) {
    if (!AVAILABLE_INTEGRATIONS.includes(integration)) {
      errors.push(
        `Unknown integration: ${integration}. Available: ${AVAILABLE_INTEGRATIONS.join(", ")}`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Load multiple integrations and merge their files
 */
export async function loadIntegrations(
  integrationNames: IntegrationName[],
): Promise<{
  integrations: ResolvedIntegration[];
  files: TemplateFile[];
  errors: string[];
}> {
  const integrations: ResolvedIntegration[] = [];
  const errors: string[] = [];
  const allFiles: TemplateFile[] = [];

  for (const name of integrationNames) {
    const integration = await loadIntegration(name);
    if (integration) {
      integrations.push(integration);
      allFiles.push(...integration.files);
    } else {
      errors.push(`Integration not found: ${name}`);
    }
  }

  // Merge files (later integrations override earlier ones)
  const fileMap = new Map<string, TemplateFile>();
  for (const file of allFiles) {
    fileMap.set(file.path, file);
  }

  return {
    integrations,
    files: Array.from(fileMap.values()).sort((a, b) => a.path.localeCompare(b.path)),
    errors,
  };
}

/**
 * Check if an integration exists
 */
export async function integrationExists(
  integrationName: string,
): Promise<boolean> {
  const fs = createFileSystem();
  const integrationDir = getIntegrationDirectory(integrationName);

  try {
    const stat = await fs.stat(integrationDir);
    return stat.isDirectory;
  } catch {
    return false;
  }
}

/**
 * Get use-case configuration
 */
export function getUseCaseConfig(useCaseName: UseCaseName): UseCaseConfig {
  return USE_CASE_CONFIGS[useCaseName];
}

/**
 * Get all available prompts for a set of integrations
 */
export async function getAvailablePrompts(
  integrationNames: IntegrationName[],
): Promise<Array<{ integration: IntegrationName; prompts: IntegrationConfig["prompts"] }>> {
  const result: Array<{ integration: IntegrationName; prompts: IntegrationConfig["prompts"] }> = [];

  for (const name of integrationNames) {
    const config = await loadIntegrationConfig(name);
    if (config && config.prompts) {
      result.push({
        integration: name,
        prompts: config.prompts,
      });
    }
  }

  return result;
}

/**
 * Load base files from the _base integration directory
 * These include setup guide page and status API
 */
export function loadIntegrationBaseFilesFromDirectory(): Promise<TemplateFile[]> {
  const baseDir = getIntegrationDirectory("_base");
  const filesDir = pathHelper.join(baseDir, "files");
  return loadTemplateFromDirectory(filesDir);
}

/**
 * Load the _base integration config to get shared env vars like APP_URL
 */
export function loadIntegrationBaseConfig(): Promise<IntegrationConfig | null> {
  return loadIntegrationConfig("_base" as IntegrationName);
}

/**
 * Generate base files needed for any integration setup
 * These are shared across all integrations
 */
export function getIntegrationBaseFiles(): TemplateFile[] {
  return [
    {
      path: "lib/token-store.ts",
      content: `/**
 * OAuth Token Store
 *
 * Manages OAuth tokens for service integrations.
 * Override this with a database implementation for production.
 */

export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
}

export interface TokenStore {
  getToken(userId: string, service: string): Promise<OAuthToken | null>;
  setToken(userId: string, service: string, token: OAuthToken): Promise<void>;
  deleteToken(userId: string, service: string): Promise<void>;
}

// In-memory store for development
// Replace with database/KV store in production
const tokens = new Map<string, OAuthToken>();

function makeKey(userId: string, service: string): string {
  return \`\${userId}:\${service}\`;
}

export const tokenStore: TokenStore = {
  async getToken(userId: string, service: string): Promise<OAuthToken | null> {
    const token = tokens.get(makeKey(userId, service));
    if (!token) return null;

    // Check if expired
    if (token.expiresAt && Date.now() > token.expiresAt) {
      // Token expired - in production, attempt refresh here
      return null;
    }

    return token;
  },

  async setToken(userId: string, service: string, token: OAuthToken): Promise<void> {
    tokens.set(makeKey(userId, service), token);
  },

  async deleteToken(userId: string, service: string): Promise<void> {
    tokens.delete(makeKey(userId, service));
  },
};

export default tokenStore;
`,
    },
    {
      path: "lib/oauth.ts",
      content: `/**
 * OAuth utilities for service integrations
 */

import { tokenStore, type OAuthToken } from "./token-store.ts";

// Helper for Cross-Platform environment access
function getEnv(key: string): string | undefined {
  // @ts-ignore - Deno global
  if (typeof Deno !== "undefined") {
    // @ts-ignore - Deno global
    return Deno.env.get(key);
  }
  // @ts-ignore - process global
  else if (typeof process !== "undefined" && process.env) {
    // @ts-ignore - process global
    return process.env[key];
  }
  return undefined;
}

export interface OAuthProvider {
  name: string;
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  callbackPath: string;
}

/**
 * Generate OAuth authorization URL
 */
export function getAuthorizationUrl(
  provider: OAuthProvider,
  state: string,
  redirectUri: string,
): string {
  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: provider.scopes.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
  });

  return \`\${provider.authorizationUrl}?\${params.toString()}\`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
): Promise<OAuthToken> {
  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(\`Token exchange failed: \${error}\`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    scope: data.scope,
    tokenType: data.token_type,
  };
}

/**
 * Refresh an expired token
 */
export async function refreshAccessToken(
  provider: OAuthProvider,
  refreshToken: string,
): Promise<OAuthToken> {
  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(\`Token refresh failed: \${error}\`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    scope: data.scope,
    tokenType: data.token_type,
  };
}

/**
 * Get a valid access token, refreshing if necessary
 */
export async function getValidToken(
  provider: OAuthProvider,
  userId: string,
  serviceName: string,
): Promise<string | null> {
  const token = await tokenStore.getToken(userId, serviceName);
  if (!token) return null;

  // Check if token needs refresh
  if (token.expiresAt && Date.now() > token.expiresAt - 60000) {
    if (token.refreshToken) {
      try {
        const newToken = await refreshAccessToken(provider, token.refreshToken);
        await tokenStore.setToken(userId, serviceName, newToken);
        return newToken.accessToken;
      } catch {
        // Refresh failed, token is invalid
        await tokenStore.deleteToken(userId, serviceName);
        return null;
      }
    }
    return null;
  }

  return token.accessToken;
}
`,
    },
    {
      path: "components/ActionCards.tsx",
      content: `"use client";

import { useState } from "react";

interface ActionCard {
  id: string;
  icon: React.ReactNode;
  title: string;
  description?: string;
  prompt: string;
  category?: string;
  users?: string;
}

interface ActionCardsProps {
  actions: ActionCard[];
  onPrompt: (prompt: string) => void;
  categories?: string[];
}

export function ActionCards({ actions, onPrompt, categories }: ActionCardsProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("featured");

  const filteredActions = selectedCategory === "featured"
    ? actions
    : actions.filter(a => a.category === selectedCategory);

  return (
    <div className="space-y-6">
      {categories && categories.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <CategoryTab
            label="Featured"
            selected={selectedCategory === "featured"}
            onClick={() => setSelectedCategory("featured")}
          />
          {categories.map(cat => (
            <CategoryTab
              key={cat}
              label={cat.charAt(0).toUpperCase() + cat.slice(1)}
              selected={selectedCategory === cat}
              onClick={() => setSelectedCategory(cat)}
            />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredActions.map(action => (
          <div
            key={action.id}
            className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6 hover:shadow-lg transition-shadow"
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 flex items-center justify-center">
                {action.icon}
              </div>
            </div>

            <h3 className="font-semibold text-neutral-900 dark:text-white mb-2">
              {action.title}
            </h3>

            {action.description && (
              <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
                {action.description}
              </p>
            )}

            <div className="flex items-center justify-between mt-4">
              <button
                onClick={() => onPrompt(action.prompt)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded-xl text-sm font-medium text-neutral-900 dark:text-white transition-colors"
              >
                <span className="text-amber-500">⚡</span>
                Try Prompt
              </button>

              {action.users && (
                <span className="text-sm text-orange-500 font-medium">
                  {action.users} Users
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CategoryTab({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={\`px-4 py-2 rounded-full text-sm font-medium transition-colors \${
        selected
          ? "bg-neutral-900 dark:bg-white text-white dark:text-neutral-900"
          : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700"
      }\`}
    >
      {label}
    </button>
  );
}

export default ActionCards;
`,
    },
    {
      path: "components/ServiceStatus.tsx",
      content: `"use client";

import { useState, useEffect } from "react";

interface Service {
  id: string;
  name: string;
  icon: React.ReactNode;
  isConnected: boolean;
  connectUrl: string;
}

interface ServiceStatusProps {
  services: Service[];
  onConnect?: (serviceId: string) => void;
}

export function ServiceStatus({ services, onConnect }: ServiceStatusProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {services.map(service => (
        <ServiceBadge
          key={service.id}
          service={service}
          onConnect={onConnect}
        />
      ))}
    </div>
  );
}

function ServiceBadge({
  service,
  onConnect,
}: {
  service: Service;
  onConnect?: (serviceId: string) => void;
}) {
  if (service.isConnected) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-full">
        <span className="w-5 h-5">{service.icon}</span>
        <span className="text-sm font-medium text-green-700 dark:text-green-400">
          {service.name}
        </span>
        <span className="w-2 h-2 bg-green-500 rounded-full"></span>
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        if (onConnect) {
          onConnect(service.id);
        } else {
          window.location.href = service.connectUrl;
        }
      }}
      className="inline-flex items-center gap-2 px-3 py-1.5 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
    >
      <span className="w-5 h-5 opacity-50">{service.icon}</span>
      <span className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
        Connect {service.name}
      </span>
    </button>
  );
}

export default ServiceStatus;
`,
    },
  ];
}
