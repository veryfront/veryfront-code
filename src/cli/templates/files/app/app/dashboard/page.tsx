import { redirect } from "veryfront";
import { getSession } from "../../lib/auth.ts";
import { DashboardLayout } from "../../components/DashboardLayout.tsx";
import { StatsGrid } from "../../components/StatsGrid.tsx";
import { RecentActivity } from "../../components/RecentActivity.tsx";

export default async function DashboardPage(): Promise<JSX.Element> {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  const { id: userId, name } = session.user;

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">Dashboard</h1>
          <p className="text-neutral-600 dark:text-neutral-400 mt-1">Welcome back, {name}</p>
        </div>

        <StatsGrid userId={userId} />
        <RecentActivity userId={userId} />
      </div>
    </DashboardLayout>
  );
}
