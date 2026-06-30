import i18n from "@/lib/i18n/config";

function currentLocale(locale?: string): string {
  return locale ?? i18n.resolvedLanguage ?? i18n.language ?? "en";
}

export function formatTokens(n: number | null | undefined, locale?: string): string {
  if (n == null) return "—";
  return new Intl.NumberFormat(currentLocale(locale), {
    notation: n >= 1e3 ? "compact" : "standard",
    minimumFractionDigits: n >= 1e3 && n < 1e6 ? 1 : 0,
    maximumFractionDigits: n >= 1e6 ? 2 : n >= 1e3 ? 1 : 0,
  }).format(n);
}

export function formatUSD(n: number | null | undefined, locale?: string): string {
  if (n == null) return "—";
  return new Intl.NumberFormat(currentLocale(locale), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatInt(n: number | null | undefined, locale?: string): string {
  if (n == null) return "—";
  return new Intl.NumberFormat(currentLocale(locale)).format(n);
}

export function formatDate(s: string | null | undefined, locale?: string): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString(currentLocale(locale));
}

export function shortId(s: string | null | undefined): string {
  return s ? s.slice(0, 8) : "—";
}

/** Compact date+time ("Jun 20, 18:30") for dense tables. */
export function formatDateShort(s: string | null | undefined, locale?: string): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(currentLocale(locale), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Final path segment of a Windows or POSIX path. */
export function baseName(path: string | null | undefined): string {
  if (!path) return "—";
  const parts = path.split(/[/\\]+/).filter(Boolean);
  return parts.at(-1) ?? path;
}

/** Strip the Windows extended-length prefix (`\\?\`, `\\?\UNC\`) for display. */
export function tidyPath(path: string): string {
  if (path.startsWith("\\\\?\\UNC\\")) return "\\\\" + path.slice(8);
  if (path.startsWith("\\\\?\\")) return path.slice(4);
  return path;
}

/**
 * Human label for a session/project. Claude Code stores projects under a slug
 * that flattens path separators to "-" (e.g. "D--Github-harness-dashboard"), so
 * prefer the real recorded cwd. `short` keeps only the final folder name.
 */
export function projectLabel(
  cwd: string | null | undefined,
  slug: string | null | undefined,
  short = false,
): string {
  const path = cwd ?? slug ?? null;
  if (!path) return "—";
  return short ? baseName(path) : tidyPath(path);
}

/** A fraction (0.201) as a signed percent ("+20.1%"). Negatives keep their sign. */
export function formatPct(frac: number): string {
  return (frac > 0 ? "+" : "") + (frac * 100).toFixed(1) + "%";
}
