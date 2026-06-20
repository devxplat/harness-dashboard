import SkillsPage from "@/app/skills/page";
import { installFailingFetch, installFetch, renderWithRange } from "@/lib/test-utils";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

describe("SkillsPage", () => {
  it("renders skill rows", async () => {
    installFetch({
      "/api/skills": [
        { skill: "review", manual_sessions: 1, tool_invocations: 0, sessions: 1, last_used: "2026-06-19T10:00:00Z" },
      ],
    });
    renderWithRange(<SkillsPage />);
    await waitFor(() => expect(screen.getByText("review")).toBeInTheDocument());
    expect(screen.getByText("You ran")).toBeInTheDocument();
  });

  it("renders the empty state", async () => {
    installFetch({ "/api/skills": [] });
    renderWithRange(<SkillsPage />);
    await waitFor(() =>
      expect(screen.getByText("No skill or slash-command activity in range.")).toBeInTheDocument(),
    );
  });

  it("renders the error state", async () => {
    installFailingFetch();
    renderWithRange(<SkillsPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
