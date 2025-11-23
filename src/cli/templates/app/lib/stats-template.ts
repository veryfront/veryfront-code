/**
 * Statistics template for app template
 * Provides dashboard statistics and activity tracking
 * @module cli/templates/app/lib/stats-template
 */

import type { TemplateFile } from "./types.ts";

/**
 * Creates the statistics library template file
 *
 * This template provides:
 * - Dashboard statistics (users, activity, revenue, growth)
 * - Recent activity tracking
 * - Mock data for development (to be replaced with real queries)
 *
 * @returns Template file for lib/stats.ts
 */
export function createStatsTemplate(): TemplateFile {
  return {
    path: "lib/stats.ts",
    content: `interface Stats {
  totalUsers: number;
  activeToday: number;
  revenue: number;
  growth: number;
}

export async function getStats(userId: string): Promise<Stats> {
  // Mock data - replace with real database queries
  return {
    totalUsers: 1234,
    activeToday: 89,
    revenue: 54321,
    growth: 12.5,
  };
}

export async function getRecentActivity(userId: string) {
  // Mock data
  return [
    {
      id: "1",
      type: "user_signup",
      description: "New user registered",
      timestamp: new Date(Date.now() - 1000 * 60 * 5),
    },
    {
      id: "2",
      type: "payment",
      description: "Payment received",
      timestamp: new Date(Date.now() - 1000 * 60 * 30),
    },
  ];
}`,
  };
}
