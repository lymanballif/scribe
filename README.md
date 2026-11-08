# Write (Scribe)

A restrained, local-first word processor. Beautiful article typography, autosave, dark mode, and an installable PWA that works offline on phone and desktop.

Documents live in your browser (IndexedDB). Nothing is sent to a server unless you self-host the optional Express API.

## Run

```bash
npm install
npm run dev        # Vite — open http://localhost:5173
npm run build
npm run preview    # production build locally
```

Optional file-based server (local / VPS only):

```bash
npm run dev:server # Express API + Vite
npm run build && npm start
```

## Writing

- Markdown shortcuts: `#`, `##`, `>`, `-`, `1.`, `---`
- Select text for the format bubble (bold, italic, H1–H3, quote, comment, YouTube, image)
- Paste or drop images (stored in your browser)
- Everything autosaves ~1s after you stop typing

## Comments

Select text → **Comment**. The panel lists all comments; resolve or delete them. Comments never appear on published pages.

## Publishing

**Publish** stores a clean article at `/your-slug` in this browser. Open that URL to read the published view. Re-publish updates it; **Unpublish** removes it.

## PWA

Install from the browser (Share → Add to Home Screen on iOS, or the install prompt on desktop/Android). Works offline after the first visit.

## Deploy

Static hosting on Vercel is the default path:

```bash
npm run build
# push to GitHub → import on Vercel, or:
npx vercel --prod
```

`vercel.json` rewrites SPA routes to `index.html` and sets cache headers for the service worker.
