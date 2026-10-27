export function formatContextPercentage(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

function finiteMetric(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatSessionOutputTokensPerSecond(
  value: number | undefined,
  locale?: string,
): string | null {
  const metric = finiteMetric(value);
  if (metric === null) return null;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(metric);
}

export function formatSessionCacheHitPercentage(
  value: number | undefined,
  locale?: string,
): string | null {
  const metric = finiteMetric(value);
  if (metric === null) return null;
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(metric / 100);
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${Math.round(value / 1_000_000)}m`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return Math.round(value).toString();
}
