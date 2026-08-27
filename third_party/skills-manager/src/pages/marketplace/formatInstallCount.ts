export function formatInstallCountLabel(installCount?: number | null): string | null {
  if (installCount == null || !Number.isFinite(installCount) || installCount <= 0) {
    return null;
  }

  if (installCount < 1000) {
    return String(Math.round(installCount));
  }

  return `${(installCount / 1000).toFixed(1)}K`;
}
