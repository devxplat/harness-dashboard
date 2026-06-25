import { AppSidebar } from "@/components/shell/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { installFetch } from "@/lib/test-utils";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
afterEach(() => vi.restoreAllMocks());

function wrap(ui: ReactElement) {
  return render(
    <TooltipProvider>
      <SidebarProvider>{ui}</SidebarProvider>
    </TooltipProvider>,
  );
}

describe("AppSidebar", () => {
  it("renders nav links and shows RTK when available", async () => {
    installFetch({ "/api/rtk": { available: true } });
    wrap(<AppSidebar />);
    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pull Requests" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("link", { name: "RTK" })).toBeInTheDocument());
  });

  it("hides RTK when unavailable", async () => {
    installFetch({ "/api/rtk": { available: false } });
    wrap(<AppSidebar />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Sessions" })).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "RTK" })).toBeNull();
  });
});
