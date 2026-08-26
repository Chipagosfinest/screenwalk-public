import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>Build with the whole journey in view.</h1>
      <Link href="/onboarding">Start setup</Link>
      <Link href="/dashboard">Open dashboard</Link>
    </main>
  );
}
