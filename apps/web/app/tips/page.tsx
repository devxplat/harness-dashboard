"use client";

import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { useApi } from "@/hooks/use-api";

export default function TipsPage() {
  const { data, error, loading } = useApi<unknown[]>("/api/tips");

  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle title="Tips" description="Rule-based suggestions to cut token spend." />
      <EmptyBlock message="No tips yet — the tips engine arrives in a follow-up." />
    </>
  );
}
