import { ReactNodeViewRenderer } from "@tiptap/react";
import { ArticleImage } from "../shared/articleExtensions";
import ImageView from "./ImageView";

export const ImageFigure = ArticleImage.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageView, {
      stopEvent: ({ event }) => {
        const el = event.target as HTMLElement | null;
        return el?.closest?.("figcaption") != null || el?.closest?.(".media-tools") != null;
      },
    });
  },
});
