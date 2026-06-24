"use client";

// Shared path/project rendering: a cell that shows either the short folder name or
// the full path (with the full path always in the hover tooltip) and a toggle button
// to flip between the two — the treatment first used on the Overview "Recent sessions"
// table, reused by every table that shows a path.
import { Button } from "@/components/ui/button";
import { projectLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useTranslation } from "react-i18next";

/** Button that flips a path column between short folder names and full paths. */
export function PathToggle({ short, onToggle }: { short: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      size="sm"
      variant="outline"
      aria-pressed={short}
      onClick={onToggle}
      title={short ? t("components.pathDisplay.showingShort") : t("components.pathDisplay.showingFull")}
    >
      {short ? t("components.pathDisplay.shortNames") : t("components.pathDisplay.fullPaths")}
    </Button>
  );
}

/**
 * A project/path cell: the short folder name or the full path per `short`, truncated,
 * with the full path always in the `title` tooltip. Pass `href` to render a link.
 * `cwd` is the real recorded path; `slug` is the flattened fallback.
 */
export function ProjectCell({
  cwd,
  slug,
  short,
  href,
  className,
}: {
  cwd?: string | null;
  slug?: string | null;
  short: boolean;
  href?: string;
  className?: string;
}) {
  const full = projectLabel(cwd, slug, false);
  const label = projectLabel(cwd, slug, short);
  const cls = cn("block max-w-[260px] truncate", className);
  return href ? (
    <Link className={cn(cls, "hover:underline")} href={href} title={full}>
      {label}
    </Link>
  ) : (
    <span className={cls} title={full}>
      {label}
    </span>
  );
}
