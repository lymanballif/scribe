import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Youtube from "@tiptap/extension-youtube";
import { Mark, Node, mergeAttributes } from "@tiptap/core";

export interface RowImage {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
}

export const MAX_ROW_IMAGES = 4;

export function rowImageRatio(im: RowImage): number {
  return im.width && im.height ? im.width / im.height : 1;
}

/**
 * Base image figure shared by the editor and the published renderer.
 * The editor layers a React node view on top of this.
 */
export const ArticleImage = Image.extend({
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
    const { caption: _c, radius: _r, ...rest } = HTMLAttributes;
    return [
      "figure",
      { class: "image-figure" },
      ["img", mergeAttributes(rest, { style: `border-radius:${node.attrs.radius ?? 0}px`, loading: "lazy" })],
      ...(node.attrs.caption ? [["figcaption", {}, node.attrs.caption] as const] : []),
    ];
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    imageRow: {
      setImageRow: (attrs: { images: RowImage[]; caption?: string; radius?: number }) => ReturnType;
    };
  }
}

/**
 * Side-by-side images. Every image sits in one row and shares the same height;
 * widths are proportional to each image's aspect ratio so nothing is cropped.
 */
export const ArticleImageRow = Node.create({
  name: "imageRow",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      images: {
        default: [] as RowImage[],
        parseHTML: (el) =>
          Array.from(el.querySelectorAll("img")).map((img) => ({
            src: img.getAttribute("src") ?? "",
            alt: img.getAttribute("alt") ?? "",
            width: Number(img.getAttribute("width")) || undefined,
            height: Number(img.getAttribute("height")) || undefined,
          })),
        renderHTML: () => ({}),
      },
      caption: {
        default: "",
        parseHTML: (el) => el.querySelector("figcaption")?.textContent ?? "",
        renderHTML: () => ({}),
      },
      radius: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute("data-radius")) || 0,
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "figure[data-image-row]" }];
  },

  renderHTML({ node }) {
    const images: RowImage[] = node.attrs.images ?? [];
    const radius = node.attrs.radius ?? 0;
    return [
      "figure",
      { class: "image-row", "data-image-row": "", "data-radius": String(radius), "data-count": String(images.length) },
      [
        "div",
        { class: "image-row-grid" },
        ...images.map((im) => [
          "div",
          { class: "image-row-cell", style: `flex:${rowImageRatio(im).toFixed(4)} 1 0%` },
          [
            "img",
            {
              src: im.src,
              alt: im.alt ?? "",
              ...(im.width ? { width: String(im.width) } : {}),
              ...(im.height ? { height: String(im.height) } : {}),
              style: `border-radius:${radius}px`,
              loading: "lazy",
            },
          ],
        ]),
      ],
      ...(node.attrs.caption ? [["figcaption", {}, node.attrs.caption] as const] : []),
    ];
  },

  addCommands() {
    return {
      setImageRow:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { caption: "", radius: 0, ...attrs, images: attrs.images.slice(0, MAX_ROW_IMAGES) },
          }),
    };
  },
});

export const ArticleYoutube = Youtube.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      radius: { default: 0 },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const { radius: _r, ...rest } = HTMLAttributes;
    return [
      "div",
      { "data-youtube-video": "" },
      [
        "iframe",
        mergeAttributes(rest, {
          src: node.attrs.src,
          style: `border-radius:${node.attrs.radius ?? 0}px`,
          allow: "autoplay; encrypted-media; picture-in-picture",
          allowfullscreen: "true",
        }),
      ],
    ];
  },
});

/** Author-side comment marks are stripped to plain spans when rendering for readers. */
export const ArticleComment = Mark.create({
  name: "comment",
  inclusive: false,
  addAttributes() {
    return { commentId: { default: null }, resolved: { default: false } };
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
  ArticleImageRow,
  ArticleYoutube,
  ArticleComment,
];
