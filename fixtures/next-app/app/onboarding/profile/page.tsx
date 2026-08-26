import Link from "next/link";

export default function ProfilePage() {
  return (
    <main>
      <h1>Profile</h1>
      <Link href="/dashboard">Finish setup</Link>
      <Link href="/help">Need help</Link>
    </main>
  );
}
