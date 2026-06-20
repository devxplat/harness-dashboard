import SessionsPage from "@/app/sessions/page";
import { installFailingFetch, installFetch, renderWithRange } from "@/lib/test-utils";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => nav.id }),
}));

afterEach(() => vi.restoreAllMocks());

const sessions = [
  {
    session_id: "s1",
    project_slug: "myproj",
    sample_cwd: null,
    started: "2026-06-19T10:00:00Z",
    ended: null,
    turns: 2,
    tokens: 100,
    cost_usd: 1,
    cost_estimated: false,
  },
];

const detail = [
  {
    uuid: "m1",
    parent_uuid: null,
    type: "user",
    timestamp: "2026-06-19T10:00:00Z",
    model: null,
    is_sidechain: false,
    agent_id: null,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_create_5m_tokens: 0,
    cache_create_1h_tokens: 0,
    prompt_text: "hello world",
    prompt_chars: 11,
    tool_calls_json: null,
    project_slug: "myproj",
    cwd: null,
  },
];

describe("SessionsPage", () => {
  it("lists sessions and filters to empty", async () => {
    nav.id = null;
    installFetch({ "/api/sessions": sessions });
    renderWithRange(<SessionsPage />);
    await waitFor(() => expect(screen.getByText("myproj")).toBeInTheDocument());
    await userEvent.type(screen.getByPlaceholderText("Filter by project or session id…"), "no-match");
    await waitFor(() => expect(screen.getByText("No sessions match.")).toBeInTheDocument());
  });

  it("renders a session detail thread", async () => {
    nav.id = "s1";
    installFetch({ "/api/sessions/s1": detail });
    renderWithRange(<SessionsPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Session" })).toBeInTheDocument());
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("renders the error state", async () => {
    nav.id = null;
    installFailingFetch();
    renderWithRange(<SessionsPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
