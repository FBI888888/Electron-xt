const XINGTU_AUTHOR_PATTERN = /xingtu\.cn\/ad\/creator\/author-homepage\/douyin-video\/([A-Za-z0-9_-]+)/i;
const DOUYIN_USER_PATTERN = /douyin\.com\/user\/([A-Za-z0-9_-]+)/i;
const URL_PATTERN = /https?:\/\/[^\s]+/gi;

export interface ParsedSource {
  url: string;
  sourceType: 'xingtu' | 'douyin';
  authorId: string | null;
}

const cleanUrl = (value: string): string => value.trim().replace(/[),，。；;]+$/u, '');

export const parseSource = (value: string): ParsedSource | null => {
  const url = cleanUrl(value);
  const xingtu = url.match(XINGTU_AUTHOR_PATTERN);
  if (xingtu?.[1]) return { url, sourceType: 'xingtu', authorId: xingtu[1] };
  if (DOUYIN_USER_PATTERN.test(url) || /v\.douyin\.com/i.test(url)) {
    return { url, sourceType: 'douyin', authorId: null };
  }
  return null;
};

export const parseSourceText = (text: string): { valid: ParsedSource[]; invalid: string[]; duplicates: number } => {
  const candidates = text.match(URL_PATTERN) ?? text.split(/[\r\n,，;；\s]+/u).filter(Boolean);
  const seen = new Set<string>();
  const valid: ParsedSource[] = [];
  const invalid: string[] = [];
  let duplicates = 0;

  for (const candidate of candidates) {
    const parsed = parseSource(candidate);
    if (!parsed) {
      invalid.push(candidate);
      continue;
    }
    if (seen.has(parsed.url)) {
      duplicates += 1;
      continue;
    }
    seen.add(parsed.url);
    valid.push(parsed);
  }

  return { valid, invalid, duplicates };
};

export const extractLinks = (text: string): string[] => {
  const urls = text.match(URL_PATTERN) ?? [];
  return [...new Set(urls.map(cleanUrl))];
};