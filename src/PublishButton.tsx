import { useState } from "react";
import { Globe, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { slugify } from "./api";

export default function PublishButton({
  publishedSlug,
  title,
  onPublish,
  onUnpublish,
}: {
  publishedSlug?: string | null;
  title: string;
  onPublish: (slug: string) => Promise<string | null>;
  onUnpublish: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveSlug = slug || slugify(title) || "untitled";

  const publish = async () => {
    setBusy(true);
    setError(null);
    const err = await onPublish(effectiveSlug);
    setBusy(false);
    if (err) setError(err);
    else setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) { setSlug(publishedSlug ?? ""); setError(null); } }}>
      <PopoverTrigger asChild>
        <Button variant={publishedSlug ? "outline" : "default"} size="sm">
          <Globe data-icon="inline-start" />
          {publishedSlug ? "Published" : "Publish"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Slug</label>
            <Input
              value={slug}
              placeholder={slugify(title) || "untitled"}
              spellCheck={false}
              onChange={(e) => setSlug(slugify(e.target.value))}
              onKeyDown={(e) => e.key === "Enter" && publish()}
            />
            <div className="text-xs text-muted-foreground truncate">/{effectiveSlug}</div>
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
          {publishedSlug && (
            <a
              href={`/${publishedSlug}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="size-3" />
              View published page
            </a>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={publish} disabled={busy || !effectiveSlug}>
              {busy ? "Publishing…" : publishedSlug ? "Update" : "Publish"}
            </Button>
            {publishedSlug && (
              <Button size="sm" variant="ghost" onClick={() => { onUnpublish(); setOpen(false); }}>
                Unpublish
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
