import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ColumnDef } from "@tanstack/react-table";
import { describe, expect, it } from "vitest";
import { DataTable } from "./data-table";

interface Row {
  name: string;
  n: number;
}

const columns: ColumnDef<Row>[] = [
  { accessorKey: "name", header: "Name", cell: ({ row }) => row.original.name },
  { accessorKey: "n", header: "Count", cell: ({ row }) => row.original.n, meta: { align: "right" } },
];

const data: Row[] = Array.from({ length: 25 }, (_, i) => ({ name: `row${i}`, n: i }));

describe("DataTable", () => {
  it("paginates and sorts on header click", async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        columns={columns}
        data={data}
        pageSize={10}
        footer={(rows) => <span>sum {rows.reduce((a, r) => a + r.n, 0)}</span>}
      />,
    );

    expect(screen.getByText("row0")).toBeInTheDocument();
    expect(screen.getByText("sum 300")).toBeInTheDocument(); // 0..24

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("row10")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("row0")).toBeInTheDocument();

    // Number columns sort descending first (row24 on top), then ascending (row0 on top).
    const countHeader = screen.getByRole("button", { name: /Count/ });
    await user.click(countHeader);
    expect(screen.getByText("row24")).toBeInTheDocument();
    await user.click(countHeader);
    expect(screen.getByText("row0")).toBeInTheDocument();
  });

  it("filters via the search box and shows the empty message", async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        columns={columns}
        data={data}
        pageSize={50}
        search={{ fields: ["name"], placeholder: "Search…", ariaLabel: "search" }}
        emptyMessage="Nothing here."
      />,
    );

    const box = screen.getByLabelText("search");
    await user.type(box, "row1");
    expect(screen.getByText("row1")).toBeInTheDocument();

    await user.clear(box);
    await user.type(box, "zzz");
    expect(screen.getByText("Nothing here.")).toBeInTheDocument();
  });
});
