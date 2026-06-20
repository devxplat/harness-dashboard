"use client";

import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { useApi } from "@/hooks/use-api";
import type { RtkInfo } from "@/lib/types";

export default function RtkPage() {
  const { data, error, loading } = useApi<RtkInfo>("/api/rtk");

  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle title="RTK" description="Token savings from the RTK CLI." />
      {data.available ? (
        <EmptyBlock message="RTK detected — detailed savings views arrive in a follow-up." />
      ) : (
        <EmptyBlock message="RTK is not installed on this machine, so there are no savings to show." />
      )}
    </>
  );
}
