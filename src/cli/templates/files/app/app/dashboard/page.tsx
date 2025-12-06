import { redirect } from "veryfront";
import { getSession } from "../../lib/auth.ts";
import { DashboardLayout } from "../../components/DashboardLayout.tsx";
import { StatsGrid } from "../../components/StatsGrid.tsx";
import { RecentActivity } from "../../components/RecentActivity.tsx";

export default async function DashboardPage() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 shadow-sm border border-slate-200 dark:border-slate-700">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2">
            Welcome back, <span className="font-semibold text-indigo-600 dark:text-indigo-400">{session.user.name}</span>! Here's what's happening with your projects.
          </p>
        </div>

        <StatsGrid userId={session.user.id} />
        <RecentActivity userId={session.user.id} />
      </div>
    </DashboardLayout>
  );
}