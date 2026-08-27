export interface MarketplaceMetaItem {
  key: string;
  kind: "author" | "install_count";
  label: string;
}

export function buildMarketplaceMetaItems(
  authorLabel?: string | null,
  installCountLabel?: string | null,
): MarketplaceMetaItem[] {
  const items: MarketplaceMetaItem[] = [];

  if (authorLabel) {
    items.push({ key: "author", kind: "author", label: authorLabel });
  }

  if (installCountLabel) {
    items.push({
      key: "install_count",
      kind: "install_count",
      label: installCountLabel,
    });
  }

  return items;
}
