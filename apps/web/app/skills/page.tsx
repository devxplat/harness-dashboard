"use client";

import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { useApi } from "@/hooks/use-api";
import { rangeQuery } from "@/lib/api";
import { useRange } from "@/lib/range";

export default function SkillsPage() {
  const { since } = useRange();
  const { data, error, loading } = useApi<unknown[]>(`/api/skills${rangeQuery(since)}`);

  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle title="Skills & commands" description="Slash commands you ran and Skill tools Claude invoked." />
      <EmptyBlock message="Skill analytics arrive in a follow-up — the breakdown query isn't wired up yet." />
    </>
  );
}
