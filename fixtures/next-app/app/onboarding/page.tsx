"use client";

import { useRouter } from "next/navigation";

export default function OnboardingPage() {
  const router = useRouter();
  return (
    <main>
      <h1>Choose your setup path</h1>
      <button onClick={() => router.push("/onboarding/profile")}>Personalize first</button>
      <button onClick={() => router.push("/dashboard")}>Skip for now</button>
    </main>
  );
}
