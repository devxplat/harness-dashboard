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

/** A fraction (0.201) as a signed percent ("+20.1%"). Negatives keep their sign. */
export function formatPct(frac: number): string {
  return (frac > 0 ? "+" : "") + (frac * 100).toFixed(1) + "%";
}
