export function formatTokens(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

export function formatUSD(n: number | null | undefined): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatInt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
}

export function shortId(s: string | null | undefined): string {
  return s ? s.slice(0, 8) : "—";
}

/** Compact date+time ("Jun 20, 18:30") for dense tables. */
export function formatDateShort(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, {
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
