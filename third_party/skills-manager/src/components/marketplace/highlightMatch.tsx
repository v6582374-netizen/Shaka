import { Fragment, type ReactNode } from "react";

/**
 * 把文本中匹配 query 任意 token 的子串用 <mark> 包裹，用于搜索结果高亮。
 *
 * 规则：
 * - query 按空白分词（与后端 filter_marketplace_skills_by_query 一致）
 * - 大小写不敏感
 * - 多个 token 的匹配区间会合并，避免重叠嵌套
 * - 空 query 或纯空白 query 返回原文
 *
 * 用于 Marketplace 卡片 name/description/author 等字段的高亮渲染。
 */
export function highlightMatch(text: string, query: string | undefined | null): ReactNode {
  const tokens = (query ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return text;
  }

  // 找出所有匹配区间 [start, end)
  const ranges: Array<[number, number]> = [];
  const lowerText = text.toLowerCase();
  for (const token of tokens) {
    const lowerToken = token.toLowerCase();
    let from = 0;
    while (true) {
      const idx = lowerText.indexOf(lowerToken, from);
      if (idx === -1) break;
      ranges.push([idx, idx + lowerToken.length]);
      from = idx + 1;
    }
  }

  if (ranges.length === 0) {
    return text;
  }

  // 区间合并（按 start 排序后扫描）
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }

  // 按区间切分文本
  const nodes: ReactNode[] = [];
  let cursor = 0;
  merged.forEach((range, i) => {
    const [start, end] = range;
    if (cursor < start) {
      nodes.push(<Fragment key={`t-${i}`}>{text.slice(cursor, start)}</Fragment>);
    }
    nodes.push(
      <mark
        key={`m-${i}`}
        style={{
          backgroundColor: "var(--primary-tint)",
          color: "var(--primary)",
          padding: "0 1px",
          borderRadius: "2px",
        }}
      >
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < text.length) {
    nodes.push(<Fragment key="t-tail">{text.slice(cursor)}</Fragment>);
  }

  return <>{nodes}</>;
}
