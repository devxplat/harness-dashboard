"use client";

import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { useApi } from "@/hooks/use-api";
import { rangeQuery } from "@/lib/api";
import { useRange } from "@/lib/range";

export default function SubagentsPage() {
  const { since } = useRange();
  const { data, error, loading } = useApi<unknown>(`/api/subagents${rangeQuery(since)}`);

  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle title="Subagents & orchestration" description="Spend by agent kind, entrypoint, and dispatch tree." />
      <EmptyBlock message="Subagent breakdown arrives in a follow-up — the orchestration query isn't wired up yet." />
    </>
  );
}
