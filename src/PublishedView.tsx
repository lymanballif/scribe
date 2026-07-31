import type { PublishedRecord } from "./api";

export default function PublishedView({
  record,
  onBack,
}: {
  record: PublishedRecord;
  onBack: () => void;
}) {
  const date = new Date(record.publishedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="published-view">
      <header className="published-bar">
        <button type="button" className="published-back" onClick={onBack}>
          ← Editor
        </button>
      </header>
      <article className="published-article">
        <header>
          <h1 className="published-title">{record.title.trim() || "Untitled"}</h1>
          <div className="published-date">{date}</div>
        </header>
        <div
          className="typeset typeset-article published-body"
          dangerouslySetInnerHTML={{ __html: record.html }}
        />
      </article>
    </div>
  );
}
