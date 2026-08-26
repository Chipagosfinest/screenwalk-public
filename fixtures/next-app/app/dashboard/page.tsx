import Link from "next/link";

export default function DashboardPage() {
  return (
    <main>
      <h1>Dashboard</h1>
      <Link href="/settings">Settings</Link>
    </main>
  );
}
