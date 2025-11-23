/**
 * App Components Templates - Dashboard Components
 *
 * @module cli/templates/app/components/dashboard-templates
 */

import type { TemplateFile } from "./types.ts";

/**
 * Dashboard component templates (DashboardLayout, StatsGrid, RecentActivity)
 */
export const dashboardComponentTemplates: TemplateFile[] = [
  {
    path: "components/DashboardLayout.tsx",
    content: `'use client';

import * as React from "react";
import { useAuth } from "./AuthProvider";

const navigation = [
  { name: "Overview", href: "/dashboard" },
  { name: "Users", href: "/dashboard/users" },
  { name: "Analytics", href: "/dashboard/analytics" },
  { name: "Settings", href: "/dashboard/settings" },
];

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex h-screen">
        {/* Sidebar */}
        <div className="w-64 bg-white shadow-sm">
          <div className="p-6">
            <h1 className="text-xl font-bold text-gray-900">My App</h1>
          </div>

          <nav className="px-3">
            {navigation.map((item) => (
              <a
                key={item.name}
                href={item.href}
                className="block px-3 py-2 mb-1 text-sm font-medium rounded-md hover:bg-gray-100"
              >
                {item.name}
              </a>
            ))}
          </nav>

          <div className="absolute bottom-0 w-64 p-6 border-t">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <p className="font-medium">{user?.name}</p>
                <p className="text-gray-500">{user?.email}</p>
              </div>
              <button
                onClick={logout}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Logout
              </button>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto">
          <main className="p-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}`,
  },
  {
    path: "components/StatsGrid.tsx",
    content: `import { getStats } from "../lib/stats";

export async function StatsGrid({ userId }: { userId: string }) {
  const stats = await getStats(userId);

  const items = [
    {
      label: "Total Users",
      value: stats.totalUsers.toLocaleString(),
      change: "+12%",
      trend: "up",
    },
    {
      label: "Active Today",
      value: stats.activeToday.toLocaleString(),
      change: "+5%",
      trend: "up",
    },
    {
      label: "Revenue",
      value: "$" + stats.revenue.toLocaleString(),
      change: "+8%",
      trend: "up",
    },
    {
      label: "Growth Rate",
      value: stats.growth + "%",
      change: "+2.3%",
      trend: "up",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {items.map((item) => (
        <div key={item.label} className="bg-white p-6 rounded-lg shadow-sm">
          <p className="text-sm text-gray-600">{item.label}</p>
          <p className="text-2xl font-bold mt-2">{item.value}</p>
          <div className="flex items-center mt-2">
            <span className={\`text-sm \${
              item.trend === "up" ? "text-green-600" : "text-red-600"
            }\`}>
              {item.change}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}`,
  },
  {
    path: "components/RecentActivity.tsx",
    content: `import { getRecentActivity } from "../lib/stats";

export async function RecentActivity({ userId }: { userId: string }) {
  const activities = await getRecentActivity(userId);

  return (
    <div className="bg-white rounded-lg shadow-sm">
      <div className="p-6 border-b">
        <h2 className="text-lg font-semibold">Recent Activity</h2>
      </div>
      <div className="divide-y">
        {activities.map((activity) => (
          <div key={activity.id} className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-medium">{activity.description}</p>
                <p className="text-sm text-gray-500 mt-1">
                  {new Date(activity.timestamp).toLocaleString()}
                </p>
              </div>
              <span className="text-sm text-gray-400">
                {activity.type}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}`,
  },
];
