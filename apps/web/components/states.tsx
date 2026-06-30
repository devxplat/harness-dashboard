"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";

export function LoadingBlock() {
  const { t } = useTranslation();
  return (
    <div className="space-y-3" aria-busy="true" aria-label={t("common.loading")}>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export function ErrorBlock({ error }: { error: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm" role="alert">
      {t("common.error")} {error}
    </div>
  );
}

export function EmptyBlock({ message }: { message: string }) {
  return <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{message}</div>;
}

export function PageTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}
