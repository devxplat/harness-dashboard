"use client";

import { useTranslation } from "react-i18next";

import { EmptyBlock, ErrorBlock, LoadingBlock, PageTitle } from "@/components/states";
import { useApi } from "@/hooks/use-api";
import type { RtkInfo } from "@/lib/types";

export default function RtkPage() {
  const { t } = useTranslation();
  const { data, error, loading } = useApi<RtkInfo>("/api/rtk");

  if (error) return <ErrorBlock error={error} />;
  if (loading || !data) return <LoadingBlock />;

  return (
    <>
      <PageTitle title={t("pages.rtk.title")} description={t("pages.rtk.description")} />
      {data.available ? (
        <EmptyBlock message={t("pages.rtk.installed")} />
      ) : (
        <EmptyBlock message={t("pages.rtk.notInstalled")} />
      )}
    </>
  );
}
