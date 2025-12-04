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

// Navigation Icons
function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}

function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  );
}

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
    </svg>
  );
}

const navigation = [
  { name: "Overview", href: "/dashboard", Icon: HomeIcon },
  { name: "Users", href: "/dashboard/users", Icon: UsersIcon },
  { name: "Analytics", href: "/dashboard/analytics", Icon: ChartIcon },
  { name: "Settings", href: "/dashboard/settings", Icon: SettingsIcon },
];

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 relative overflow-hidden">
      {/* Background Blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[70%] h-[70%] rounded-full bg-purple-500/10 blur-3xl animate-blob"></div>
        <div className="absolute top-[20%] -right-[10%] w-[70%] h-[70%] rounded-full bg-indigo-500/10 blur-3xl animate-blob animation-delay-2000"></div>
      </div>

      <div className="flex h-screen relative z-10">
        {/* Sidebar */}
        <div className="w-72 bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border-r border-slate-200/50 dark:border-slate-700/50 flex flex-col shadow-2xl">
          {/* Logo */}
          <div className="p-8 border-b border-slate-200/50 dark:border-slate-700/50">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <SparklesIcon className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">My App</h1>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Dashboard</p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-8 space-y-2">
            {navigation.map((item) => (
              <a
                key={item.name}
                href={item.href}
                className="flex items-center gap-3 px-4 py-3.5 text-sm font-medium rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all group"
              >
                <item.Icon className="w-5 h-5 group-hover:text-indigo-500 transition-colors" />
                {item.name}
              </a>
            ))}
          </nav>

          {/* User Profile */}
          <div className="p-4 border-t border-slate-200/50 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-slate-800 shadow-sm border border-slate-200/50 dark:border-slate-700/50">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white font-bold shadow-md">
                {user?.name?.[0]?.toUpperCase() || "U"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{user?.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{user?.email}</p>
              </div>
              <button
                onClick={logout}
                className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                title="Logout"
              >
                <LogoutIcon className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto">
          <main className="p-8 lg:p-12 max-w-7xl mx-auto">
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

// Stat Icons
function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}

function ActivityIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  );
}

function DollarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  );
}

function TrendingUpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
      <polyline points="17 6 23 6 23 12"/>
    </svg>
  );
}

function TrendingDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/>
      <polyline points="17 18 23 18 23 12"/>
    </svg>
  );
}

export async function StatsGrid({ userId }: { userId: string }) {
  const stats = await getStats(userId);

  const items = [
    {
      label: "Total Users",
      value: stats.totalUsers.toLocaleString(),
      change: "+12%",
      trend: "up",
      Icon: UsersIcon,
      color: "from-blue-500 to-cyan-500",
      bgColor: "bg-blue-500/10",
      shadowColor: "shadow-blue-500/20",
    },
    {
      label: "Active Today",
      value: stats.activeToday.toLocaleString(),
      change: "+5%",
      trend: "up",
      Icon: ActivityIcon,
      color: "from-emerald-500 to-teal-500",
      bgColor: "bg-emerald-500/10",
      shadowColor: "shadow-emerald-500/20",
    },
    {
      label: "Revenue",
      value: "$" + stats.revenue.toLocaleString(),
      change: "+8%",
      trend: "up",
      Icon: DollarIcon,
      color: "from-violet-500 to-purple-500",
      bgColor: "bg-violet-500/10",
      shadowColor: "shadow-violet-500/20",
    },
    {
      label: "Growth Rate",
      value: stats.growth + "%",
      change: "+2.3%",
      trend: "up",
      Icon: TrendingUpIcon,
      color: "from-orange-500 to-amber-500",
      bgColor: "bg-orange-500/10",
      shadowColor: "shadow-orange-500/20",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {items.map((item) => (
        <div
          key={item.label}
          className="group bg-white/60 dark:bg-slate-800/60 backdrop-blur-lg p-6 rounded-2xl shadow-sm border border-slate-200/50 dark:border-slate-700/50 hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
        >
          <div className="flex items-center justify-between mb-4">
            <div className={\`w-12 h-12 rounded-xl \${item.bgColor} flex items-center justify-center group-hover:scale-110 transition-transform duration-300 \${item.shadowColor} shadow-lg\`}>
              <item.Icon className={\`w-6 h-6 bg-gradient-to-r \${item.color}\`} style={{ stroke: 'currentColor' }} />
            </div>
            <div className={\`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold \${
              item.trend === "up"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
            }\`}>
              {item.trend === "up" ? (
                <TrendingUpIcon className="w-3 h-3" />
              ) : (
                <TrendingDownIcon className="w-3 h-3" />
              )}
              {item.change}
            </div>
          </div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">{item.label}</p>
          <p className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">{item.value}</p>
        </div>
      ))}
    </div>
  );
}`,
  },
  {
    path: "components/RecentActivity.tsx",
    content: `import { getRecentActivity } from "../lib/stats";

// Activity Icons
function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

function ActivityIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  );
}

// Activity type badge colors
function getActivityColor(type: string) {
  const colors: Record<string, string> = {
    login: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    purchase: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    signup: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 border-violet-200 dark:border-violet-800",
    update: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    default: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-400 border-slate-200 dark:border-slate-600",
  };
  return colors[type.toLowerCase()] || colors.default;
}

export async function RecentActivity({ userId }: { userId: string }) {
  const activities = await getRecentActivity(userId);

  return (
    <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-lg rounded-2xl shadow-sm border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-slate-200/50 dark:border-slate-700/50 flex items-center justify-between bg-white/50 dark:bg-slate-800/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
            <ActivityIcon className="w-5 h-5 text-indigo-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Recent Activity</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Latest actions from your users</p>
          </div>
        </div>
        <a
          href="/dashboard/activity"
          className="px-4 py-2 rounded-lg text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
        >
          View all
        </a>
      </div>

      {/* Activity List */}
      <div className="divide-y divide-slate-200/50 dark:divide-slate-700/50">
        {activities.map((activity) => (
          <div key={activity.id} className="p-6 hover:bg-white/50 dark:hover:bg-slate-700/30 transition-colors group">
            <div className="flex items-start gap-4">
              {/* Time indicator */}
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center group-hover:bg-indigo-50 dark:group-hover:bg-indigo-900/20 transition-colors">
                <ClockIcon className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition-colors" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  {activity.description}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1">
                  <ClockIcon className="w-3 h-3" />
                  {new Date(activity.timestamp).toLocaleString()}
                </p>
              </div>

              {/* Type badge */}
              <span className={\`flex-shrink-0 px-3 py-1 rounded-full text-xs font-bold border \${getActivityColor(activity.type)}\`}>
                {activity.type}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {activities.length === 0 && (
        <div className="p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
            <ActivityIcon className="w-8 h-8 text-slate-300 dark:text-slate-600" />
          </div>
          <p className="text-slate-500 dark:text-slate-400 font-medium">No recent activity</p>
        </div>
      )}
    </div>
  );
}`,
  },
];
