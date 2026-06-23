import { OnboardingGate } from "@/components/onboarding/onboarding-gate";
import { installFetch } from "@/lib/test-utils";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

afterEach(() => {
  vi.restoreAllMocks();
  nav.replace.mockClear();
});

const base = { claude_dir: "/c", projects_dir: "/p", projects_overridden: false, claude_dirs: ["/c"], plan: "api", providers: [] };

describe("OnboardingGate", () => {
  it("redirects to onboarding on a fresh install", async () => {
    installFetch({ "/api/settings": { ...base, onboarding_done: false } });
    render(<OnboardingGate />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/onboarding"));
  });

  it("does not redirect once onboarding is done", async () => {
    installFetch({ "/api/settings": { ...base, onboarding_done: true } });
    render(<OnboardingGate />);
    await waitFor(() => expect(true).toBe(true));
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("does not redirect when the field is absent (older server)", async () => {
    installFetch({ "/api/settings": base });
    render(<OnboardingGate />);
    await waitFor(() => expect(true).toBe(true));
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
