import { redirect } from "next/navigation";
import Workspace from "@/components/workspace";
import { getCurrentUser } from "@/lib/auth";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Fdashboard");
  return <Workspace initialUser={user} />;
}
