# Write (Scribe)

A restrained, local-first word processor. Beautiful article typography, autosave, dark mode, an installable PWA that works offline on phone and desktop — and, when you want feedback, a share link that looks great and lets anyone comment.

Documents live in your browser (IndexedDB). Nothing leaves the device until you press **Share**.

## Run

```bash
npm install
npm run dev        # API on :4871 + Vite on :5190 → open http://localhost:5190
```

`npm run dev:client` runs only the editor (sharing will say the server isn't reachable).

Production:

```bash
npm run build      # typechecks client + server, builds dist/
npm start          # serves dist/ and the API on $PORT (default 4871)
```

## Writing

- Markdown shortcuts: `#`, `##`, `>`, `-`, `1.`, `---`
- Select text for the format bubble (bold, italic, H1–H3, quote, Comment)
- Everything autosaves ~1s after you stop typing

## Photos

Every way photos arrive goes through the same pipeline: they're resized (long edge ≤ 2000px), orientation-corrected, and re-encoded (WebP where the browser can, JPEG otherwise) so a 6 MB phone photo lands at a few hundred KB.

- **Add photos** button (top right; bottom-right pill on phones — opens Photos/Camera on iOS and Android)
- **+** on any empty line: Photos, Side by side, YouTube, Divider
- Drag photos anywhere onto the page, or paste them
- **Two or more photos at once become a side-by-side row.** Rows keep every photo at the same height with widths proportional to each one's aspect ratio, so nothing is cropped. Up to four per row.
- Hover a single photo → the columns icon adds a photo beside it (turning it into a row). Hover a row photo → move left/right or remove; remove down to one and it becomes a plain photo again.
- Round corners and captions on both photos and rows.

## Sharing & comments

**Share** creates an unguessable link (`/s/abc123xyz0`) in one step — no slugs to pick. Your name becomes the byline. The link unfurls with a title, excerpt, and cover photo in iMessage, Slack, and the like.

Readers get a clean article page. They can:

- **highlight any passage** → a Comment pill appears → type a note (their name is remembered)
- leave general comments at the bottom

Everything comes back to you: the comments bubble in the editor shows a red badge for new reader comments; the panel lists them with the quoted passage, and clicking one selects that text in your draft. Resolve or delete from there. Your own notes-to-self live in the same panel and never appear on the shared page.

Edited since you shared? The **Shared** button shows a dot and offers **Update link**. **Stop sharing** removes the page and its comments.

## Server

The API in `server/` is small and self-contained. Storage is pluggable:

| Mode | When | Where data lives |
|---|---|---|
| File (default) | `DATABASE_URL` unset | `data/shares/*.json`, `data/images/*` — `npm run backup` tars it |
| Postgres | `DATABASE_URL` set | three tables, created automatically on boot (images stored as `bytea`) |

Environment variables:

| Variable | Purpose |
|---|---|
| `PORT` | listen port (default `4871`) |
| `DATABASE_URL` | enables the Postgres store |
| `DATA_DIR` | file-store location (default `./data`) |
| `SHARE_KEY` | optional. When set, creating shares and uploading photos requires it; the Share popover asks for it once and remembers it in the browser. Set this on any public deployment so strangers can't publish to your server. |
| `PUBLIC_URL` | optional. Forces the origin used in link-preview tags (otherwise derived from the request). |

Security notes: share tokens are random per document and stored hashed; only the holder can update, delete, resolve, or moderate. Article HTML is rendered server-side from the document JSON (never trusted from the client), image uploads are sniffed and limited to webp/jpeg/png/gif, and comments are rate-limited per IP.

## Deploy

**Simplest: a Node host with a disk** (Fly.io, Railway, Render, a VPS). Build, run `npm start`, mount a volume at `data/`. Zero config.

**Vercel (or any serverless host) needs Postgres.** `api/index.ts` exports the Express app and `vercel.json` routes `/api/*`, `/s/*`, and `/i/*` to it. In the project settings set:

- `DATABASE_URL` — Neon, Supabase, Vercel Postgres, etc.
- `NODEJS_HELPERS=0` — so Vercel hands Express the raw request body
- `SHARE_KEY` — recommended

Note: the Vercel path is configured but hasn't been exercised in a real deployment yet; the Node server path and both stores have.

**Static-only hosting** still works for the editor and offline writing; Share will explain that sharing isn't set up on that deployment.

## PWA

Install from the browser (Share → Add to Home Screen on iOS, or the install prompt on desktop/Android). Works offline after the first visit; shared pages need the network.
