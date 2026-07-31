import Youtube from "@tiptap/extension-youtube";
import { ReactNodeViewRenderer } from "@tiptap/react";
import YoutubeView from "./YoutubeView";

export const YoutubeFigure = Youtube.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      radius: { default: 0 },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(YoutubeView, {
      stopEvent: ({ event }) =>
        (event.target as HTMLElement | null)?.closest?.(".radius-toggle") != null,
    });
  },
});
