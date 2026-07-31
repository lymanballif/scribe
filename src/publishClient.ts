import { renderToHTMLString } from "@tiptap/static-renderer";
import { articleExtensions } from "./articleExtensions";

export function renderArticleHtml(content: unknown): string {
  if (!content) return "";
  try {
    return renderToHTMLString({
      extensions: articleExtensions,
      content: content as Parameters<typeof renderToHTMLString>[0]["content"],
    });
  } catch {
    return "";
  }
}
