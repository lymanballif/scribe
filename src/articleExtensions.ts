import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Youtube from "@tiptap/extension-youtube";
import { Mark, mergeAttributes } from "@tiptap/core";

const ArticleImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      caption: { default: "" },
      radius: { default: 0 },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "figure",
      { class: "image-figure" },
      ["img", mergeAttributes(HTMLAttributes, { style: `border-radius:${node.attrs.radius ?? 0}px` })],
      ...(node.attrs.caption ? [["figcaption", {}, node.attrs.caption] as const] : []),
    ];
  },
});

const ArticleYoutube = Youtube.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      radius: { default: 0 },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      { "data-youtube-video": "" },
      [
        "iframe",
        mergeAttributes(HTMLAttributes, {
          src: node.attrs.src,
          style: `border-radius:${node.attrs.radius ?? 0}px`,
          allow: "autoplay; encrypted-media; picture-in-picture",
          allowfullscreen: "true",
        }),
      ],
    ];
  },
});

const ArticleComment = Mark.create({
  name: "comment",
  inclusive: false,
  addAttributes() {
    return { commentId: { default: null } };
  },
  parseHTML() {
    return [{ tag: "span[data-comment-id]" }];
  },
  renderHTML() {
    return ["span", {}, 0];
  },
});

export const articleExtensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
  ArticleImage,
  ArticleYoutube,
  ArticleComment,
];
