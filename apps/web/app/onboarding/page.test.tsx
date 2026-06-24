import OnboardingPage from "@/app/onboarding/page";
import { installFetch } from "@/lib/test-utils";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

afterEach(() => vi.restoreAllMocks());

describe("OnboardingPage", () => {
  it("renders the setup wizard", async () => {
    installFetch({
      "/api/settings": {
        claude_dir: "/c",
        projects_dir: "/p",
        projects_overridden: false,
        claude_dirs: ["/c"],
        plan: "api",
        onboarding_done: false,
        providers: [],
      },
      "/api/integrations": {
        github: { configured: false, repo_count: 0, last_sync: null },
        google: { configured: false, last_sync: null },
      },
    });
    render(<OnboardingPage />);
    await waitFor(() => expect(screen.getByText("Set up your dashboard")).toBeInTheDocument());
  });
});
