import fs from "node:fs";
import path from "node:path";
import type { SharePublic } from "../shared/types";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let cached: { file: string; html: string; mtime: number } | null = null;

export function loadShell(distDir: string): string | null {
  const file = path.join(distDir, "index.html");
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (!cached || cached.file !== file || cached.mtime !== mtime) {
      cached = { file, html: fs.readFileSync(file, "utf8"), mtime };
    }
    return cached.html;
  } catch {
    return null;
  }
}

export interface PageMeta {
  title: string;
  description: string;
  image: string | null;
  url: string;
  author: string | null;
  publishedAt: string;
}

/**
 * Inject Open Graph / Twitter tags and preload the share so the reader page
 * renders on first paint and unfurls nicely in iMessage, Slack, and the like.
 */
export function renderSharePage(shell: string, meta: PageMeta, share: SharePublic | null): string {
  const title = meta.title || "Untitled";
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<link rel="canonical" href="${esc(meta.url)}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(meta.url)}" />`,
    meta.author ? `<meta property="article:author" content="${esc(meta.author)}" />` : "",
    `<meta property="article:published_time" content="${esc(meta.publishedAt)}" />`,
    meta.image ? `<meta property="og:image" content="${esc(meta.image)}" />` : "",
    `<meta name="twitter:card" content="${meta.image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    meta.image ? `<meta name="twitter:image" content="${esc(meta.image)}" />` : "",
    `<meta name="robots" content="noindex" />`,
    `<script>window.__SHARE__=${JSON.stringify(share).replace(/</g, "\\u003c")};</script>`,
  ]
    .filter(Boolean)
    .join("\n    ");

  return shell
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
    .replace(/<meta name="description"[^>]*>\s*/i, "")
    .replace("</head>", `    ${tags}\n  </head>`);
}
