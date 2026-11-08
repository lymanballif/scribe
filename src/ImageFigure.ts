import Image from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import ImageView from "./ImageView";

export const ImageFigure = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      caption: {
        default: "",
        parseHTML: (element) => element.closest("figure")?.querySelector("figcaption")?.textContent ?? "",
      },
      radius: { default: 0 },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "figure",
      { class: "image-figure" },
      ["img", { ...HTMLAttributes, style: `border-radius:${node.attrs.radius ?? 0}px` }],
      ["figcaption", {}, node.attrs.caption || ""],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView, {
      stopEvent: ({ event }) => {
        const el = event.target as HTMLElement | null;
        return el?.closest?.("figcaption") != null || el?.closest?.(".radius-toggle") != null;
      },
    });
  },
});
