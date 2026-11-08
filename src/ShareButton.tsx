import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Link2, Share as ShareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getAuthorName, setAuthorName, type ShareInfo } from "./api";
import { ShareError, getShareKey, setShareKey, type ShareProgress } from "./share";
import { timeAgo } from "./time";

export default function ShareButton({
  share,
  stale,
  onShare,
  onUnshare,
}: {
  share: ShareInfo | null;
  stale: boolean;
  onShare: (author: string, onProgress: (p: ShareProgress) => void) => Promise<void>;
  onUnshare: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [author, setAuthor] = useState(getAuthorName);
  const [key, setKey] = useState(getShareKey);
  const [needKey, setNeedKey] = useState(false);
  const [progress, setProgress] = useState<ShareProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  const run = async () => {
    setError(null);
    setAuthorName(author);
    setShareKey(key);
    setProgress({ stage: "photos", done: 0, total: 0 });
    try {
      await onShare(author.trim(), setProgress);
      setNeedKey(false);
    } catch (e) {
      const err = e as ShareError;
      if (err.code === "key_required") setNeedKey(true);
      setError(err.message || "Couldn't share right now.");
    } finally {
      setProgress(null);
    }
  };

  const copy = async () => {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.url);
      setCopied(true);
    } catch {
      // Clipboard can be blocked in insecure contexts; the field below is selectable.
    }
  };

  const nativeShare = async () => {
    if (!share) return;
    try {
      await navigator.share({ url: share.url, title: document.title });
    } catch {
      /* dismissed */
    }
  };

  const busy = progress !== null;
  const progressLabel = !progress
    ? ""
    : progress.stage === "photos" && progress.total > 0
      ? `Uploading photos ${Math.min(progress.done + 1, progress.total)}/${progress.total}…`
      : progress.stage === "photos"
        ? "Preparing…"
        : "Publishing…";

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setError(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant={share ? "outline" : "default"} size="sm" className="share-trigger">
          {share ? <Link2 data-icon="inline-start" /> : <ShareIcon data-icon="inline-start" />}
          {share ? "Shared" : "Share"}
          {share && stale && <span className="share-dot" title="Changes not yet shared" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 share-pop">
        {!share ? (
          <div className="flex flex-col gap-3">
            <div>
              <div className="share-heading">Share a link</div>
              <p className="share-help">
                Anyone with the link can read this and leave comments. Comments show up in your Comments panel.
              </p>
            </div>
            <label className="share-field">
              <span>Your name</span>
              <Input
                value={author}
                placeholder="Shown as the author"
                autoComplete="name"
                onChange={(e) => setAuthor(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && run()}
              />
            </label>
            {needKey && (
              <label className="share-field">
                <span>Share key</span>
                <Input
                  value={key}
                  type="password"
                  placeholder="From your server's SHARE_KEY"
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !busy && run()}
                />
              </label>
            )}
            {error && <div className="share-error">{error}</div>}
            <Button onClick={run} disabled={busy}>
              {busy ? progressLabel : "Create link"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <div className="share-heading">Your link</div>
              <p className="share-help">
                {stale ? "You've edited since you shared. Update the link when you're ready." : `Last shared ${timeAgo(share.sharedAt)}.`}
              </p>
            </div>
            <div className="share-url-row">
              <input className="share-url" readOnly value={share.url} onFocus={(e) => e.currentTarget.select()} />
              <Button size="icon" variant="outline" className="size-9 shrink-0" onClick={copy} title="Copy link" aria-label="Copy link">
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {stale ? (
                <Button size="sm" onClick={run} disabled={busy}>
                  {busy ? progressLabel : "Update link"}
                </Button>
              ) : (
                <Button size="sm" onClick={copy}>
                  {copied ? "Copied" : "Copy link"}
                </Button>
              )}
              {canNativeShare && (
                <Button size="sm" variant="outline" onClick={nativeShare}>
                  <ShareIcon data-icon="inline-start" />
                  Send…
                </Button>
              )}
              <a href={share.url} target="_blank" rel="noreferrer" className="share-open">
                <ExternalLink className="size-3" />
                Open
              </a>
            </div>
            {needKey && (
              <label className="share-field">
                <span>Share key</span>
                <Input value={key} type="password" onChange={(e) => setKey(e.target.value)} />
              </label>
            )}
            {error && <div className="share-error">{error}</div>}
            <div className="share-footer">
              {!stale && (
                <Button size="sm" variant="ghost" onClick={run} disabled={busy}>
                  {busy ? progressLabel : "Re-share"}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="share-stop"
                disabled={busy}
                onClick={async () => {
                  if (!confirm("Stop sharing? The link will stop working and reader comments will be deleted.")) return;
                  setError(null);
                  try {
                    await onUnshare();
                    setOpen(false);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Stop sharing
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
