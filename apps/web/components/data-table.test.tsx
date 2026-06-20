import { render, screen, waitFor } from "@testing-library/react";
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

  it("filters (debounced) via the search box, offers suggestions, and shows the empty message", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <DataTable
        columns={columns}
        data={data}
        pageSize={50}
        search={{ fields: ["name"], placeholder: "Search…", ariaLabel: "search" }}
        emptyMessage="Nothing here."
      />,
    );

    // Autocomplete suggestions are populated from the searchable field values.
    expect(container.querySelectorAll("datalist option").length).toBeGreaterThan(0);

    const box = screen.getByLabelText("search");
    await user.type(box, "row7");
    // Debounced: the filter settles after the timeout, leaving only the match.
    await waitFor(() => {
      expect(screen.getByText("row7")).toBeInTheDocument();
      expect(screen.queryByText("row1")).toBeNull();
    });

    await user.clear(box);
    await user.type(box, "zzz");
    await waitFor(() => expect(screen.getByText("Nothing here.")).toBeInTheDocument());
  });

  it("hides a column via the Columns menu", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={data} pageSize={50} />);
    expect(screen.getByRole("columnheader", { name: /Name/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Columns/ }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Name" }));
    expect(screen.queryByRole("columnheader", { name: /Name/ })).toBeNull();
  });
});
