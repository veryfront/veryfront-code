"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildSetupSteps,
  CATEGORIES,
  filterIntegrations,
  getTokenStorageStyles,
  groupIntegrationsByCategory,
  type Integration,
  OAUTH_SETUP_GUIDES,
  ServiceIcon,
  type TokenStorageStatus,
} from "./page-helpers";

export default function SetupPage(): React.JSX.Element {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGuide, setExpandedGuide] = useState<string | null>(null);
  const [envChecked, setEnvChecked] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [tokenStorage, setTokenStorage] = useState<TokenStorageStatus | null>(null);

  useEffect(() => {
    void fetchStatus();
    void fetchTokenStorage();
  }, []);

  async function fetchStatus(): Promise<void> {
    try {
      const res = await fetch("/api/integrations/status");
      if (!res.ok) {
        console.error("Failed to fetch integration status:", res.status);
        setIntegrations([]);
        return;
      }

      const data = await res.json();
      setIntegrations(data.integrations ?? []);
    } catch (error) {
      console.error("Failed to fetch integration status:", error);
      setIntegrations([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchTokenStorage(): Promise<void> {
    const fallback: TokenStorageStatus = { mode: "memory", encrypted: false };

    try {
      const res = await fetch("/api/integrations/token-storage");
      if (!res.ok) {
        setTokenStorage(fallback);
        return;
      }
      const data = await res.json();
      setTokenStorage(data);
    } catch {
      setTokenStorage(fallback);
    }
  }

  const filteredIntegrations = useMemo(
    () => filterIntegrations(integrations, searchQuery, selectedCategory),
    [integrations, searchQuery, selectedCategory],
  );

  const groupedIntegrations = useMemo(
    () => groupIntegrationsByCategory(filteredIntegrations),
    [filteredIntegrations],
  );

  const connectedCount = integrations.filter((i) => i.connected).length;
  const totalCount = integrations.length;
  const progress = totalCount > 0 ? (connectedCount / totalCount) * 100 : 0;

  const allConnected = connectedCount === totalCount && totalCount > 0;

  const setupSteps = useMemo(
    () => buildSetupSteps(envChecked, allConnected, () => setEnvChecked(true)),
    [allConnected, envChecked],
  );

  const tokenStorageStyles = useMemo(() => getTokenStorageStyles(tokenStorage), [tokenStorage]);

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-neutral-900 dark:text-white mb-4">
            Setup Your AI Agent
          </h1>
          <p className="text-lg text-neutral-600 dark:text-neutral-400">
            Connect your services to enable AI-powered automation
          </p>
        </div>

        <div className="bg-white dark:bg-neutral-800 rounded-2xl p-6 shadow-sm border border-neutral-200 dark:border-neutral-700 mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
              Setup Progress
            </span>
            <span className="text-sm font-medium text-neutral-900 dark:text-white">
              {connectedCount} / {totalCount} services connected
            </span>
          </div>
          <div className="w-full bg-neutral-200 dark:bg-neutral-700 rounded-full h-3">
            <div
              className="bg-gradient-to-r from-green-500 to-emerald-500 h-3 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {tokenStorage && tokenStorageStyles && (
          <div className={tokenStorageStyles.container}>
            <div className="flex items-start gap-4">
              <div className={tokenStorageStyles.iconWrapper}>
                {tokenStorageStyles.isMemory ? (
                  <svg
                    className="w-5 h-5 text-amber-600 dark:text-amber-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-5 h-5 text-green-600 dark:text-green-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                    />
                  </svg>
                )}
              </div>

              <div className="flex-1">
                <h3 className={tokenStorageStyles.title}>
                  Token Storage:{" "}
                  {tokenStorageStyles.isMemory
                    ? "Development Mode"
                    : `${tokenStorage.mode.charAt(0).toUpperCase()}${tokenStorage.mode.slice(
                        1,
                      )} Storage`}
                </h3>

                <p className={tokenStorageStyles.text}>
                  {tokenStorageStyles.isMemory ? (
                    <>Tokens are stored in memory and will be lost on restart.</>
                  ) : (
                    <>Tokens are persisted to {tokenStorage.mode} storage.</>
                  )}
                </p>

                <div className="mt-2 flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                  <span>Encryption enabled {tokenStorage.autoGenerated && "(auto-generated key)"}</span>
                </div>

                {tokenStorageStyles.isMemory && (
                  <div className="mt-4 pt-4 border-t border-amber-200 dark:border-amber-800">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-3">
                      For production, add one of these to your{" "}
                      <code className="px-1 py-0.5 bg-amber-100 dark:bg-amber-900 rounded text-xs">
                        .env
                      </code>
                      :
                    </p>
                    <div className="grid gap-2">
                      <a
                        href="https://upstash.com/docs/redis/overall/getstarted"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between p-3 bg-white dark:bg-neutral-800 rounded-lg border border-green-200 dark:border-green-700 hover:border-green-400 dark:hover:border-green-500 transition-colors group"
                      >
                        <div>
                          <span className="font-medium text-neutral-900 dark:text-white">
                            Upstash
                          </span>
                          <span className="text-green-600 dark:text-green-400 text-xs ml-2 font-medium">
                            Recommended
                          </span>
                          <span className="text-neutral-500 dark:text-neutral-400 text-sm ml-2">
                            Serverless Redis, scales horizontally
                          </span>
                        </div>
                        <code className="text-xs bg-neutral-100 dark:bg-neutral-700 px-2 py-1 rounded text-neutral-600 dark:text-neutral-300">
                          REDIS_URL
                        </code>
                      </a>

                      <a
                        href="https://docs.turso.tech/quickstart"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between p-3 bg-white dark:bg-neutral-800 rounded-lg border border-amber-200 dark:border-amber-700 hover:border-amber-400 dark:hover:border-amber-500 transition-colors group"
                      >
                        <div>
                          <span className="font-medium text-neutral-900 dark:text-white">
                            Turso / libSQL
                          </span>
                          <span className="text-neutral-500 dark:text-neutral-400 text-sm ml-2">
                            Edge SQLite, fast reads globally
                          </span>
                        </div>
                        <code className="text-xs bg-neutral-100 dark:bg-neutral-700 px-2 py-1 rounded text-neutral-600 dark:text-neutral-300">
                          DATABASE_URL
                        </code>
                      </a>

                      <a
                        href="https://vercel.com/docs/storage/vercel-kv/quickstart"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between p-3 bg-white dark:bg-neutral-800 rounded-lg border border-amber-200 dark:border-amber-700 hover:border-amber-400 dark:hover:border-amber-500 transition-colors group"
                      >
                        <div>
                          <span className="font-medium text-neutral-900 dark:text-white">
                            Vercel KV
                          </span>
                          <span className="text-neutral-500 dark:text-neutral-400 text-sm ml-2">
                            Built-in if using Vercel
                          </span>
                        </div>
                        <code className="text-xs bg-neutral-100 dark:bg-neutral-700 px-2 py-1 rounded text-neutral-600 dark:text-neutral-300">
                          KV_REST_API_URL
                        </code>
                      </a>

                      <a
                        href="https://neon.tech/docs/get-started-with-neon/connect-neon"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between p-3 bg-white dark:bg-neutral-800 rounded-lg border border-amber-200 dark:border-amber-700 hover:border-amber-400 dark:hover:border-amber-500 transition-colors group"
                      >
                        <div>
                          <span className="font-medium text-neutral-900 dark:text-white">Neon</span>
                          <span className="text-neutral-500 dark:text-neutral-400 text-sm ml-2">
                            Serverless Postgres
                          </span>
                        </div>
                        <code className="text-xs bg-neutral-100 dark:bg-neutral-700 px-2 py-1 rounded text-neutral-600 dark:text-neutral-300">
                          DATABASE_URL
                        </code>
                      </a>

                      <a
                        href="https://www.sqlite.org/index.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between p-3 bg-white dark:bg-neutral-800 rounded-lg border border-amber-200 dark:border-amber-700 hover:border-amber-400 dark:hover:border-amber-500 transition-colors group"
                      >
                        <div>
                          <span className="font-medium text-neutral-900 dark:text-white">
                            SQLite
                          </span>
                          <span className="text-neutral-500 dark:text-neutral-400 text-sm ml-2">
                            Local file, single instance only
                          </span>
                        </div>
                        <code className="text-xs bg-neutral-100 dark:bg-neutral-700 px-2 py-1 rounded text-neutral-600 dark:text-neutral-300">
                          DATABASE_URL=file:./data.db
                        </code>
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 mb-8 overflow-hidden">
          <div className="p-6 border-b border-neutral-200 dark:border-neutral-700">
            <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">
              Quick Start Guide
            </h2>
          </div>
          <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
            {setupSteps.map((step, index) => (
              <div key={step.id} className="p-6 flex items-start gap-4">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    step.completed
                      ? "bg-green-500 text-white"
                      : "bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-400"
                  }`}
                >
                  {step.completed ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    <span className="font-semibold">{index + 1}</span>
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-neutral-900 dark:text-white">{step.title}</h3>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 overflow-hidden">
          <div className="p-6 border-b border-neutral-200 dark:border-neutral-700">
            <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">
              Service Connections
            </h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
              Click on a service to see setup instructions or connect
            </p>

            <div className="mt-4">
              <input
                type="text"
                placeholder="Search services..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl text-neutral-900 dark:text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedCategory(null)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  selectedCategory === null
                    ? "bg-neutral-900 dark:bg-white text-white dark:text-neutral-900"
                    : "bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-600"
                }`}
              >
                All
              </button>

              {CATEGORIES.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() =>
                    setSelectedCategory(selectedCategory === category.id ? null : category.id)
                  }
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    selectedCategory === category.id
                      ? "bg-neutral-900 dark:bg-white text-white dark:text-neutral-900"
                      : "bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-600"
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center text-neutral-500">Loading...</div>
          ) : filteredIntegrations.length === 0 ? (
            <div className="p-12 text-center text-neutral-500">
              No services found matching your search
            </div>
          ) : (
            <div>
              {CATEGORIES.filter((cat) => groupedIntegrations[cat.id]?.length > 0).map(
                (category) => (
                  <div key={category.id}>
                    <div className="px-6 py-3 bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700">
                      <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                        {category.name}
                      </h3>
                    </div>

                    <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
                      {groupedIntegrations[category.id]?.map((integration) => {
                        const guide = OAUTH_SETUP_GUIDES[integration.id];
                        const isExpanded = expandedGuide === integration.id;

                        return (
                          <div key={integration.id}>
                            <div className="p-6 flex items-center justify-between">
                              <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-neutral-100 dark:bg-neutral-700 rounded-xl flex items-center justify-center">
                                  <ServiceIcon name={integration.icon} />
                                </div>
                                <div>
                                  <h3 className="font-semibold text-neutral-900 dark:text-white">
                                    {integration.name}
                                  </h3>
                                  <p
                                    className={`text-sm ${
                                      integration.connected
                                        ? "text-green-600 dark:text-green-400"
                                        : "text-neutral-500"
                                    }`}
                                  >
                                    {integration.connected ? "Connected" : "Not connected"}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-3">
                                {guide && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedGuide(isExpanded ? null : integration.id)
                                    }
                                    className="px-4 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
                                  >
                                    {isExpanded ? "Hide Guide" : "Setup Guide"}
                                  </button>
                                )}

                                {integration.connected ? (
                                  <span className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-xl text-sm font-medium">
                                    <span className="w-2 h-2 bg-green-500 rounded-full" />
                                    Connected
                                  </span>
                                ) : (
                                  <a
                                    href={integration.connectUrl}
                                    className="px-4 py-2 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
                                  >
                                    Connect
                                  </a>
                                )}
                              </div>
                            </div>

                            {isExpanded && guide && (
                              <div className="px-6 pb-6">
                                <div className="bg-neutral-50 dark:bg-neutral-900 rounded-xl p-6 border border-neutral-200 dark:border-neutral-700">
                                  <h4 className="font-semibold text-neutral-900 dark:text-white mb-4">
                                    {guide.title}
                                  </h4>

                                  <ol className="space-y-3 mb-6">
                                    {guide.steps.map((step, i) => (
                                      <li key={i} className="flex items-start gap-3">
                                        <span className="w-6 h-6 bg-neutral-200 dark:bg-neutral-700 rounded-full flex items-center justify-center text-sm font-medium text-neutral-600 dark:text-neutral-400 flex-shrink-0">
                                          {i + 1}
                                        </span>
                                        <span className="text-neutral-700 dark:text-neutral-300">
                                          {step}
                                        </span>
                                      </li>
                                    ))}
                                  </ol>

                                  <div className="mb-4 p-4 bg-neutral-100 dark:bg-neutral-800 rounded-lg">
                                    <h5 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-2">
                                      Required Environment Variables:
                                    </h5>
                                    <pre className="text-sm text-neutral-600 dark:text-neutral-400 font-mono whitespace-pre-wrap">
                                      {guide.envVars.map((v) => `${v}=your_value`).join("\n")}
                                    </pre>
                                  </div>

                                  <a
                                    href={guide.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 text-blue-600 dark:text-blue-400 text-sm font-medium hover:underline"
                                  >
                                    Open Developer Console
                                    <svg
                                      className="w-4 h-4"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                                      />
                                    </svg>
                                  </a>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </div>

        {allConnected && (
          <div className="mt-8 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-2xl p-6 border border-green-200 dark:border-green-800 text-center">
            <div className="text-4xl mb-4">🎉</div>
            <h3 className="text-xl font-semibold text-green-800 dark:text-green-200 mb-2">
              All Services Connected!
            </h3>
            <p className="text-green-700 dark:text-green-300 mb-4">
              Your AI agent is ready to use. Start chatting to automate your workflows.
            </p>
            <a
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition-colors"
            >
              Start Using Your Agent
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
