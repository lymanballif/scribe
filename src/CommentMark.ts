import { Mark, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    comment: {
      setComment: (commentId: string) => ReturnType;
      unsetComment: (commentId: string) => ReturnType;
    };
  }
}

export const CommentMark = Mark.create({
  name: "comment",

  inclusive: false,

  addAttributes() {
    return {
      commentId: { default: null },
      resolved: {
        default: false,
        parseHTML: (el) => el.dataset.resolved === "true",
        renderHTML: (attrs) => (attrs.resolved ? { "data-resolved": "true" } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-comment-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-comment-id": HTMLAttributes.commentId,
        class: "comment-mark",
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setComment:
        (commentId) =>
        ({ commands }) =>
          commands.setMark(this.name, { commentId, resolved: false }),
      unsetComment:
        (commentId) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return true;
          state.doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type.name === this.name && mark.attrs.commentId === commentId) {
                tr.removeMark(pos, pos + node.nodeSize, mark.type);
              }
            });
          });
          return true;
        },
    };
  },
});
