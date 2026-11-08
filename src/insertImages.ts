import type { Editor } from "@tiptap/core";
import { prepareImages, type PrepareProgress } from "./images";
import { MAX_ROW_IMAGES } from "../shared/articleExtensions";

export interface InsertOptions {
  /** Document position to insert at; defaults to the current selection. */
  pos?: number;
  /** Force a side-by-side row even for a single image (used by the "+" menu). */
  forceRow?: boolean;
  onProgress?: (p: PrepareProgress) => void;
}

/**
 * One entry point for every way photos arrive: picker, paste, drop.
 * Two or more photos at once become a side-by-side row; one becomes a figure.
 */
export async function insertImageFiles(editor: Editor, files: File[], opts: InsertOptions = {}): Promise<number> {
  const prepared = await prepareImages(files, opts.onProgress);
  if (!prepared.length) return 0;

  const nodes =
    prepared.length >= 2 || opts.forceRow
      ? chunk(prepared, MAX_ROW_IMAGES).map((images) => ({
          type: "imageRow",
          attrs: { images, caption: "", radius: 0 },
        }))
      : [{ type: "image", attrs: { ...prepared[0], alt: "", caption: "", radius: 0 } }];

  const chain = editor.chain().focus();
  if (opts.pos !== undefined) chain.insertContentAt(opts.pos, nodes);
  else chain.insertContent(nodes);
  chain.run();
  return prepared.length;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  // Avoid a lonely trailing image after a full row: rebalance 5 → 3 + 2, etc.
  if (out.length > 1 && out[out.length - 1].length === 1) {
    const prev = out[out.length - 2];
    out[out.length - 1].unshift(prev.pop()!);
  }
  return out;
}
