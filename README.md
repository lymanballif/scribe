# Write (Scribe)

A restrained, local-first word processor. Beautiful article typography, autosave, dark mode, an installable PWA that works offline on phone and desktop — and, when you want feedback, a share link that looks great and lets anyone comment.

Documents are always saved locally in IndexedDB. When private cloud storage is configured and you sign in, documents, embedded photos, notes and share-author permissions also sync to your private library. **Share** remains a separate, deliberate public-publishing action.

Cloud is disabled by default. The interface distinguishes **Saved here** from **All changes in cloud**; local-only mode is not a cloud backup.

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
- Every edit saves locally immediately; private cloud sync is debounced, retried after reconnecting, and checked while the app is open

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


## Private document cloud

The owner library uses a private key (one library per deployment), not public share links. Sign in with the same key on another trusted device. The key itself is never saved in browser storage; the server issues an expiring HttpOnly, SameSite=Strict cookie. Signing out leaves local offline documents on the device. This is not a multi-account service or end-to-end encryption.

Required production configuration, after the correct deployment is verified:

- `DOCUMENTS_KEY`: a securely generated random private library key, at least 24 characters. Keep it in the host's secret manager, never in Git, client code, messages or public deployment output. Rotating it revokes all sessions.
- `DATABASE_URL`: an approved Postgres connection with verified TLS. Private data uses separate `scribe_private_*` tables. Vercel refuses local file storage for private documents.
- `PUBLIC_URL`: exact HTTPS origin, for example the verified app origin. Writes reject other origins.
- `NODEJS_HELPERS=0` on Vercel, as for the existing Express API.
- Add host-level login throttling for production. The built-in limiter is per process, so it is not a distributed abuse control.

For a single-process Node server with a durable private disk, the existing `DATA_DIR` can hold the private library under `private/`. Do not place it inside `dist/`, serve it statically, or run multiple file-store writers. Production deployments should use Postgres. Back up the database separately and test restoring it.

### Migration and recovery

1. Keep the original browser and its existing backup intact. Do not clear browser storage.
2. Take **Download safety backup** on the original device. This is a private JSON file containing documents, photos, local recovery snapshots and any share-author tokens. Store it privately.
3. Only after private hosting, access and backups are verified, sign in using **Connect and back up documents** on the original app origin. IndexedDB upgrades add stores without deleting the old document stores. Original documents are snapshotted before migration.
4. Documents keep their IDs. Their exact JSON and embedded photo data are stored in authenticated 256 KiB chunks. SHA-256 verification checks both directions before success is shown. Repeating a completed upload is idempotent.
5. Verify document count, content and photos in a fresh signed-in session. Do not treat the live articles as migrated before this verification. An HTTP success alone is not enough.
6. Offline writes remain queued. Concurrent cloud edits are preserved as a separate cloud conflict copy; neither version is silently discarded. A newer remote edit prevents a stale delete.
7. An actively mounted editor is not replaced by background downloads. **Sync now** or reopening a document releases it for refresh. A second tab cannot edit the same document until the first releases it; this prevents stale tabs from overwriting new work.
8. **Recover a document** offers local snapshots and the latest 50 cloud versions. Restoring makes a separate copy. Deleted cloud records remain recoverable tombstones. **Import safety backup** restores document copies and preserves the included recovery snapshots; repeating a recovery does not create duplicates.

Cloud sync preserves full embedded images and supports documents up to 100 MiB. Larger documents remain local with a visible error. Remote-linked images stay remote-linked, just as in the original document. This implementation does not automatically publish documents or make private chunks accessible through `/i/`.

### Checks

```
npm run build
npm test
npm run test:postgres  # isolated local PostgreSQL; requires initdb and pg_ctl
```

The PostgreSQL integration test starts and stops its own temporary cluster; it does not touch existing database services. Browser verification should include a fresh session, conflicting changes, repeated restoration and rapid document switching.

**Rollout status:** source changes are ready for review; production cloud configuration and migration of the existing live browser documents are separate steps. Do not deploy to a similarly named project without verifying its repository and domain.
