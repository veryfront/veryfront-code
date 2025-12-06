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
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">Dashboard</h1>
          <p className="text-neutral-600 dark:text-neutral-400 mt-1">
            Welcome back, {session.user.name}
          </p>
        </div>

        <StatsGrid userId={session.user.id} />
        <RecentActivity userId={session.user.id} />
      </div>
    </DashboardLayout>
  );
}
