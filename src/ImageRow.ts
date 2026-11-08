import { ReactNodeViewRenderer } from "@tiptap/react";
import { ArticleImageRow } from "../shared/articleExtensions";
import ImageRowView from "./ImageRowView";

export const ImageRow = ArticleImageRow.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageRowView, {
      stopEvent: ({ event }) => {
        const el = event.target as HTMLElement | null;
        return el?.closest?.("figcaption") != null || el?.closest?.(".media-tools") != null;
      },
    });
  },
});
