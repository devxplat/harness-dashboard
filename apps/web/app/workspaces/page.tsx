"use client";

import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { useApi } from "@/hooks/use-api";
import { rangeQuery } from "@/lib/api";
import { useRange } from "@/lib/range";

export default function WorkspacesPage() {
  const { since } = useRange();
  const { data, error, loading } = useApi<unknown>(`/api/workspaces${rangeQuery(since)}`);

  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle title="Workspaces" description="How file edits flow across project workspaces." />
      <EmptyBlock message="The workspace flow (Sankey) arrives in a follow-up — the classification query isn't wired up yet." />
    </>
  );
}
