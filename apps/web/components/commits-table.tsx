"use client";

// The Productivity "Commits" view: a filterable table with autocomplete facets for
// project and author (the latter also matching Co-authored-by trailers) plus an AI
// filter, on top of the shared DataTable. Co-authors are surfaced inline.
import { DataTable } from "@/components/data-table";
import { PathToggle, ProjectCell } from "@/components/path-display";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateShort, formatInt, projectLabel, shortId } from "@/lib/format";
import type { CommitRow } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";
import type { TFunction } from "i18next";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type AiFilter = "all" | "ai" | "human";

/** Display name from a "Name <email>" trailer (falls back to the raw string). */
function personName(s: string): string {
  const name = s.split("<")[0]?.trim();
  return name && name.length > 0 ? name : s;
}

/** All people on a commit (author + co-authors), for filtering. */
function peopleOf(c: CommitRow): string[] {
  return [c.author_name, ...c.coauthors].filter((p): p is string => !!p);
}

function AiBadge({ row }: { row: CommitRow }) {
  if (!row.ai_assisted) return <span className="text-xs text-muted-foreground">—</span>;
  const why = [
    row.ai_session_overlap ? "session overlap" : null,
    row.ai_coauthor_trailer ? "co-author trailer" : null,
  ]
    .filter(Boolean)
    .join(" + ");
  return (
    <span
      title={why}
      className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary"
    >
      AI
    </span>
  );
}

function AuthorCell({ row }: { row: CommitRow }) {
  return (
    <div className="max-w-[180px]">
      <span className="block truncate text-xs">{row.author_name ?? "—"}</span>
      {row.coauthors.length > 0 ? (
        <span
          className="block truncate text-[11px] text-muted-foreground"
          title={row.coauthors.join("\n")}
        >
          + {row.coauthors.map(personName).join(", ")}
        </span>
      ) : null}
    </div>
  );
}

const makeColumns = (short: boolean, t: TFunction): ColumnDef<CommitRow>[] => [
  {
    accessorKey: "authored_at_utc",
    header: t("components.commitsTable.when"),
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {formatDateShort(row.original.authored_at_utc)}
      </span>
    ),
  },
  {
    accessorKey: "project_slug",
    header: t("components.commitsTable.project"),
    cell: ({ row }) => (
      <ProjectCell
        cwd={row.original.sample_cwd}
        slug={row.original.project_slug}
        short={short}
        className="max-w-[180px]"
      />
    ),
  },
  {
    accessorKey: "subject",
    header: t("components.commitsTable.commit"),
    cell: ({ row }) => (
      <span className="flex items-center gap-2">
        <span className="block max-w-[320px] truncate" title={row.original.subject ?? undefined}>
          {row.original.subject ?? "—"}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">{shortId(row.original.sha)}</span>
      </span>
    ),
  },
  {
    accessorKey: "author_name",
    header: t("components.commitsTable.author"),
    cell: ({ row }) => <AuthorCell row={row.original} />,
  },
  {
    accessorKey: "insertions",
    header: t("components.commitsTable.lines"),
    cell: ({ row }) => (
      <span className="whitespace-nowrap tabular-nums">
        <span className="text-emerald-600 dark:text-emerald-400">+{formatInt(row.original.insertions)}</span>{" "}
        <span className="text-rose-600 dark:text-rose-400">−{formatInt(row.original.deletions)}</span>
      </span>
    ),
    meta: { align: "right" },
  },
  {
    id: "ai",
    header: t("components.commitsTable.ai"),
    cell: ({ row }) => <AiBadge row={row.original} />,
    meta: { align: "right" },
  },
];

export function CommitsTable({ commits }: { commits: CommitRow[] }) {
  const { t } = useTranslation();
  const [short, setShort] = useState(true);
  const [projectFilter, setProjectFilter] = useState("");
  const [authorFilter, setAuthorFilter] = useState("");
  const [aiFilter, setAiFilter] = useState<AiFilter>("all");
  const columns = useMemo(() => makeColumns(short, t), [short, t]);
  const projectListId = useId();
  const authorListId = useId();

  const projectOptions = useMemo(
    () => [...new Set(commits.map((c) => projectLabel(c.sample_cwd, c.project_slug, short)))].sort(),
    [commits, short],
  );
  const authorOptions = useMemo(
    () => [...new Set(commits.flatMap((c) => peopleOf(c).map(personName)))].sort(),
    [commits],
  );

  const filtered = useMemo(
    () =>
      commits.filter((c) => {
        const label = projectLabel(c.sample_cwd, c.project_slug, short).toLowerCase();
        const matchProject = !projectFilter || label.includes(projectFilter.toLowerCase());
        const people = peopleOf(c).join(" ").toLowerCase();
        const matchAuthor = !authorFilter || people.includes(authorFilter.toLowerCase());
        const matchAi =
          aiFilter === "all" || (aiFilter === "ai" ? c.ai_assisted : !c.ai_assisted);
        return matchProject && matchAuthor && matchAi;
      }),
    [commits, projectFilter, authorFilter, aiFilter, short],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          list={projectListId}
          placeholder={t("components.commitsTable.projectPlaceholder")}
          aria-label="Filter by project"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="max-w-[220px]"
        />
        <datalist id={projectListId}>
          {projectOptions.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <Input
          list={authorListId}
          placeholder={t("components.commitsTable.authorPlaceholder")}
          aria-label="Filter by author"
          value={authorFilter}
          onChange={(e) => setAuthorFilter(e.target.value)}
          className="max-w-[220px]"
        />
        <datalist id={authorListId}>
          {authorOptions.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        <Select value={aiFilter} onValueChange={(v) => setAiFilter(v as AiFilter)}>
          <SelectTrigger className="w-[150px]" aria-label="Filter by AI">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("components.commitsTable.allCommits")}</SelectItem>
            <SelectItem value="ai">{t("components.commitsTable.aiAssisted")}</SelectItem>
            <SelectItem value="human">{t("components.commitsTable.byHand")}</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {commits.length}
        </span>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        search={{
          fields: ["subject", "sha"],
          placeholder: t("components.commitsTable.searchPlaceholder"),
          ariaLabel: "Search commits",
        }}
        actions={<PathToggle short={short} onToggle={() => setShort((v) => !v)} />}
        pageSize={25}
        emptyMessage={t("components.commitsTable.noMatch")}
      />
    </div>
  );
}
