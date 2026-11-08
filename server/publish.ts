const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `
@font-face {
  font-family: 'Inter Variable';
  src: url('/fonts/inter-latin-wght-normal.woff2') format('woff2');
  font-weight: 100 900;
  font-display: swap;
}
:root {
  --bg: #fff; --text: #1a1a1a; --muted: #6b6b6b; --faint: #a3a3a3;
  --border: #ececec; --code-bg: #f4f4f4;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #101010; --text: #e6e6e6; --muted: #9c9c9c; --faint: #666;
    --border: #262626; --code-bg: #1e1e1e;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: 'Inter Variable', ui-sans-serif, system-ui, sans-serif;
  font-feature-settings: 'cv11', 'ss01';
  -webkit-font-smoothing: antialiased;
}
article {
  max-width: 640px;
  margin: 0 auto;
  padding: 96px 24px 128px;
  font-size: 17.5px;
  line-height: 1.75;
  letter-spacing: -0.006em;
}
header { margin-bottom: 2.5em; }
h1.title {
  font-size: 2em;
  font-weight: 700;
  letter-spacing: -0.022em;
  line-height: 1.2;
  margin: 0 0 0.35em;
}
.date { font-size: 13px; color: var(--faint); }
p { margin: 1.25em 0 0; }
h1, h2, h3 {
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.3;
  margin: 2em 0 0;
}
h1 { font-size: 1.5em; } h2 { font-size: 1.2em; } h3 { font-size: 1em; }
h1 + p, h2 + p, h3 + p { margin-top: 0.6em; }
blockquote {
  margin: 1.5em 0 0;
  padding-left: 1.1em;
  border-left: 2px solid var(--border);
  color: var(--muted);
  font-style: italic;
}
blockquote p { margin: 0; }
ul, ol { padding-left: 1.4em; margin: 1.25em 0 0; }
li { margin-top: 0.35em; }
li::marker { color: var(--faint); }
hr { border: none; border-top: 1px solid var(--border); margin: 2.5em 0 0; }
code {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.86em;
  background: var(--code-bg);
  border-radius: 4px;
  padding: 0.15em 0.35em;
}
pre {
  background: var(--code-bg);
  border-radius: 8px;
  padding: 14px 16px;
  overflow-x: auto;
  margin: 1.5em 0 0;
  font-size: 14px;
  line-height: 1.6;
}
pre code { background: none; padding: 0; }
a { color: inherit; text-decoration-color: var(--faint); text-underline-offset: 2px; }
figure { margin: 2em 0 0; }
figure img { display: block; max-width: 100%; height: auto; margin: 0 auto; }
figcaption {
  margin-top: 10px;
  text-align: center;
  font-size: 13.5px;
  color: var(--muted);
}
div[data-youtube-video] { margin: 2em 0 0; }
div[data-youtube-video] iframe {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  height: auto;
  border: 0;
}
`;

export function articlePage(opts: { title: string; html: string; publishedAt: string }) {
  const date = new Date(opts.publishedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(opts.title || "Untitled")}</title>
<meta name="description" content="${esc(opts.title || "Untitled")}" />
<style>${CSS}</style>
</head>
<body>
<article>
<header>
<h1 class="title">${esc(opts.title || "Untitled")}</h1>
<div class="date">${date}</div>
</header>
${opts.html}
</article>
</body>
</html>`;
}
