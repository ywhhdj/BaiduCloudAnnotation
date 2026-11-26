import type { UrlRule } from './types';

/** 把 `.../id/*\/page_id/*` 这类通配符规则编译成正则（* 含 /，可覆盖 filter/mode 尾缀） */
export function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function candidateUrls(href: string): string[] {
  const out = [href];
  const clean = href.replace(/[#?].*$/, '');
  if (clean !== href) out.push(clean);
  return out;
}

/** 命中的第一条规则；规则顺序即优先级，可在设置页调整 */
export function matchUrlRule(href: string, rules: UrlRule[]): UrlRule | null {
  if (!href || !Array.isArray(rules)) return null;
  const list = rules.filter((r) => r && r.enabled && typeof r.pattern === 'string' && r.pattern);
  for (const rule of list) {
    let re: RegExp;
    try { re = wildcardToRegExp(rule.pattern); } catch { continue; }
    if (candidateUrls(href).some((u) => re.test(u))) return rule;
  }
  return null;
}

export function isAssistUrl(href: string, rules: UrlRule[]): boolean {
  return matchUrlRule(href, rules) !== null;
}

/** 从任意 /id/<任意字符>/page_id/<任意字符>[/尾缀] 中解析任务键；page_id 不是帧号 */
export function parseTaskKey(href: string): {
  markId: string;
  pageId: string;
  pathname: string
} {
  let pathname = href;
  try { pathname = new URL(href, 'https://test.baidu.com').pathname; } catch { /* 已是 path */ }
  const idMatch = pathname.match(/\/id\/([^/]+)/i);
  const pageMatch = pathname.match(/\/page_id\/([^/]+)/i);
  const safe = (v?: string) => {
    try {
      return v ? decodeURIComponent(v) : '';
    } catch {
      return v || '';
    }
  };
  return {
    markId: safe(idMatch?.[1]),
    pageId: safe(pageMatch?.[1]),
    pathname,
  };
}

/** manifest.matches 与 URL_RULES 的一致性校验（不构建、不联网，仅静态提示用） */
export function describeRule(rule: UrlRule): string {
  return `${rule.id}: ${rule.pattern}${rule.description ? ` · ${rule.description}` : ''}`;
}
