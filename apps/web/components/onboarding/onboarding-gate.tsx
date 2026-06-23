"use client";

// First-run guard. On a fresh install the server reports `onboarding_done: false`;
// we send the user to the setup wizard once. Older servers omit the field
// (undefined) — we never force-redirect in that case, so existing installs are
// untouched. Renders nothing; it only performs the redirect side-effect.
import { useApi } from "@/hooks/use-api";
import type { SettingsInfo } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function OnboardingGate() {
  const { data } = useApi<SettingsInfo>("/api/settings");
  const router = useRouter();

  useEffect(() => {
    if (data?.onboarding_done === false) router.replace("/onboarding");
  }, [data, router]);

  return null;
}
