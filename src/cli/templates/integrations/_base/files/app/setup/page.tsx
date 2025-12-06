"use client";

import { useEffect, useState } from "react";

interface Integration {
  id: string;
  name: string;
  icon: string;
  connected: boolean;
  connectUrl: string;
}

interface SetupStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  action?: () => void;
  link?: string;
}

const OAUTH_SETUP_GUIDES: Record<string, { title: string; steps: string[]; link: string }> = {
  gmail: {
    title: "Google OAuth Setup (Gmail & Calendar)",
    steps: [
      "Go to Google Cloud Console",
      "Create a new project or select existing one",
      "Enable Gmail API and Calendar API",
      "Create OAuth 2.0 credentials (Web application)",
      "Add redirect URI: http://localhost:3000/api/auth/gmail/callback",
      "Copy Client ID and Secret to your .env file",
    ],
    link: "https://console.cloud.google.com/apis/credentials",
  },
  calendar: {
    title: "Google Calendar Setup",
    steps: [
      "Uses same credentials as Gmail",
      "Make sure Calendar API is enabled",
      "Add redirect URI: http://localhost:3000/api/auth/calendar/callback",
    ],
    link: "https://console.cloud.google.com/apis/credentials",
  },
  slack: {
    title: "Slack App Setup",
    steps: [
      "Go to Slack API Apps page",
      "Create New App > From scratch",
      "Add OAuth Scopes: channels:read, chat:write, users:read",
      "Install to Workspace",
      "Copy Client ID and Secret to your .env file",
      "Add redirect URL: http://localhost:3000/api/auth/slack/callback",
    ],
    link: "https://api.slack.com/apps",
  },
  github: {
    title: "GitHub OAuth App Setup",
    steps: [
      "Go to GitHub Developer Settings",
      "Click 'New OAuth App'",
      "Set Homepage URL to http://localhost:3000",
      "Set callback URL to http://localhost:3000/api/auth/github/callback",
      "Copy Client ID and Secret to your .env file",
    ],
    link: "https://github.com/settings/developers",
  },
  jira: {
    title: "Atlassian (Jira) Setup",
    steps: [
      "Go to Atlassian Developer Console",
      "Create OAuth 2.0 integration",
      "Add Jira API scopes",
      "Set callback URL: http://localhost:3000/api/auth/jira/callback",
      "Copy Client ID and Secret to your .env file",
    ],
    link: "https://developer.atlassian.com/console/myapps/",
  },
  notion: {
    title: "Notion Integration Setup",
    steps: [
      "Go to Notion Integrations page",
      "Create new integration",
      "Copy the Internal Integration Token",
      "Add token to your .env file",
      "Share desired pages with your integration",
    ],
    link: "https://www.notion.so/my-integrations",
  },
};

export default function SetupPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGuide, setExpandedGuide] = useState<string | null>(null);
  const [envChecked, setEnvChecked] = useState(false);

  useEffect(() => {
    fetchStatus();
  }, []);

  async function fetchStatus() {
    try {
      const res = await fetch("/api/integrations/status");
      const data = await res.json();
      setIntegrations(data.integrations);
    } catch (error) {
      console.error("Failed to fetch integration status:", error);
    } finally {
      setLoading(false);
    }
  }

  const connectedCount = integrations.filter((i) => i.connected).length;
  const totalCount = integrations.length;
  const progress = totalCount > 0 ? (connectedCount / totalCount) * 100 : 0;

  const setupSteps: SetupStep[] = [
    {
      id: "env",
      title: "Configure Environment Variables",
      description: "Add your OAuth credentials to the .env file",
      completed: envChecked,
      action: () => setEnvChecked(true),
    },
    {
      id: "oauth",
      title: "Create OAuth Apps",
      description: "Set up OAuth applications for each service",
      completed: false,
    },
    {
      id: "connect",
      title: "Connect Services",
      description: "Authorize your app to access each service",
      completed: connectedCount === totalCount && totalCount > 0,
    },
  ];

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900">
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-neutral-900 dark:text-white mb-4">
            Setup Your AI Agent
          </h1>
          <p className="text-lg text-neutral-600 dark:text-neutral-400">
            Connect your services to enable AI-powered automation
          </p>
        </div>

        {/* Progress Bar */}
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

        {/* Setup Steps */}
        <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 mb-8 overflow-hidden">
          <div className="p-6 border-b border-neutral-200 dark:border-neutral-700">
            <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">
              Quick Start Guide
            </h2>
          </div>
          <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
            {setupSteps.map((step, index) => (
              <div
                key={step.id}
                className="p-6 flex items-start gap-4"
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    step.completed
                      ? "bg-green-500 text-white"
                      : "bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-400"
                  }`}
                >
                  {step.completed
                    ? (
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )
                    : <span className="font-semibold">{index + 1}</span>}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-neutral-900 dark:text-white">
                    {step.title}
                  </h3>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Service Connections */}
        <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 overflow-hidden">
          <div className="p-6 border-b border-neutral-200 dark:border-neutral-700">
            <h2 className="text-xl font-semibold text-neutral-900 dark:text-white">
              Service Connections
            </h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
              Click on a service to see setup instructions or connect
            </p>
          </div>

          {loading
            ? <div className="p-12 text-center text-neutral-500">Loading...</div>
            : (
              <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
                {integrations.map((integration) => (
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
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedGuide(
                              expandedGuide === integration.id ? null : integration.id,
                            )}
                          className="px-4 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
                        >
                          {expandedGuide === integration.id ? "Hide Guide" : "Setup Guide"}
                        </button>
                        {integration.connected
                          ? (
                            <span className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-xl text-sm font-medium">
                              <span className="w-2 h-2 bg-green-500 rounded-full" />
                              Connected
                            </span>
                          )
                          : (
                            <a
                              href={integration.connectUrl}
                              className="px-4 py-2 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
                            >
                              Connect
                            </a>
                          )}
                      </div>
                    </div>

                    {/* Expanded Setup Guide */}
                    {expandedGuide === integration.id && (() => {
                      const guide = OAUTH_SETUP_GUIDES[integration.id];
                      if (!guide) return null;
                      return (
                        <div className="px-6 pb-6">
                          <div className="bg-neutral-50 dark:bg-neutral-900 rounded-xl p-6 border border-neutral-200 dark:border-neutral-700">
                            <h4 className="font-semibold text-neutral-900 dark:text-white mb-4">
                              {guide.title}
                            </h4>
                            <ol className="space-y-3">
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
                            <a
                              href={guide.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-4 inline-flex items-center gap-2 text-blue-600 dark:text-blue-400 text-sm font-medium hover:underline"
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
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
        </div>

        {/* All Connected Message */}
        {connectedCount === totalCount && totalCount > 0 && (
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

function ServiceIcon({ name }: { name: string }) {
  const iconMap: Record<string, JSX.Element> = {
    mail: (
      <svg className="w-6 h-6 text-red-500" fill="currentColor" viewBox="0 0 24 24">
        <path
          d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
        />
      </svg>
    ),
    slack: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
        <path
          d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
          fill="#E01E5A"
        />
        <path
          d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
          fill="#36C5F0"
        />
        <path
          d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"
          fill="#2EB67D"
        />
        <path
          d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"
          fill="#ECB22E"
        />
      </svg>
    ),
    calendar: (
      <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    ),
    github: (
      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
        <path
          fillRule="evenodd"
          d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
          clipRule="evenodd"
        />
      </svg>
    ),
    jira: (
      <svg className="w-6 h-6" viewBox="0 0 24 24">
        <defs>
          <linearGradient id="jira-gradient" x1="98.031%" x2="58.888%" y1=".161%" y2="40.766%">
            <stop offset="0%" stopColor="#0052CC" />
            <stop offset="100%" stopColor="#2684FF" />
          </linearGradient>
        </defs>
        <path
          fill="url(#jira-gradient)"
          d="M11.571 11.513H0a5.218 5.218 0 005.232 5.215h2.13v2.057A5.215 5.215 0 0012.575 24V12.518a1.005 1.005 0 00-1.005-1.005z"
        />
        <path
          fill="#2684FF"
          d="M17.151 5.97H5.58a5.215 5.215 0 005.215 5.214h2.129v2.058a5.218 5.218 0 005.232 5.215V6.975a1.005 1.005 0 00-1.005-1.005z"
        />
        <path
          fill="#2684FF"
          d="M22.723.426H11.152a5.215 5.215 0 005.215 5.215h2.129v2.057a5.218 5.218 0 005.232 5.215V1.431a1.005 1.005 0 00-1.005-1.005z"
        />
      </svg>
    ),
    notion: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.98-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466l1.823 1.447zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.84-.046.933-.56.933-1.167V6.354c0-.606-.233-.933-.746-.886l-15.177.887c-.56.046-.747.326-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.746 0-.933-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.14c-.093-.514.28-.886.747-.933l3.222-.186zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.933.653.933 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.448-1.632z" />
      </svg>
    ),
  };

  return iconMap[name] || (
    <svg className="w-6 h-6 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 10V3L4 14h7v7l9-11h-7z"
      />
    </svg>
  );
}
