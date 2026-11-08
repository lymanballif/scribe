import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { ChevronLeft, ChevronRight, ImagePlus, X } from "lucide-react";
import RadiusToggle from "./RadiusToggle";
import { pickImageFiles } from "./pickFiles";
import { prepareImages } from "./images";
import { MAX_ROW_IMAGES, rowImageRatio, type RowImage } from "../shared/articleExtensions";

export default function ImageRowView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const images: RowImage[] = node.attrs.images ?? [];
  const caption: string = node.attrs.caption ?? "";
  const radius: number = node.attrs.radius ?? 0;

  const setImages = (next: RowImage[]) => {
    if (next.length === 1) {
      // A row of one is just a photo; hand it back to the plain figure so it reads naturally.
      const pos = getPos();
      if (pos === undefined) return;
      const only = next[0];
      editor
        .chain()
        .focus()
        .deleteRange({ from: pos, to: pos + node.nodeSize })
        .insertContentAt(pos, {
          type: "image",
          attrs: { src: only.src, alt: only.alt ?? "", width: only.width ?? null, height: only.height ?? null, caption, radius },
        })
        .run();
      return;
    }
    updateAttributes({ images: next });
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= images.length) return;
    const next = images.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setImages(next);
  };

  const remove = (i: number) => {
    const next = images.filter((_, k) => k !== i);
    if (next.length === 0) {
      const pos = getPos();
      if (pos !== undefined) editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
      return;
    }
    setImages(next);
  };

  const add = async () => {
    const room = MAX_ROW_IMAGES - images.length;
    if (room <= 0) return;
    const files = await pickImageFiles(true);
    if (!files.length) return;
    const prepared = await prepareImages(files.slice(0, room));
    if (prepared.length) updateAttributes({ images: [...images, ...prepared] });
  };

  const stop = (e: React.MouseEvent) => e.preventDefault();

  return (
    <NodeViewWrapper
      as="figure"
      className={"image-row not-typeset" + (selected ? " selected" : "")}
      data-image-row=""
      data-count={images.length}
    >
      <div className="image-row-grid">
        {images.map((im, i) => (
          <div key={im.src.slice(-48) + i} className="image-row-cell" style={{ flex: `${rowImageRatio(im)} 1 0%` }}>
            <img
              src={im.src}
              alt={im.alt ?? ""}
              width={im.width}
              height={im.height}
              draggable="false"
              style={{ borderRadius: radius }}
              onLoad={(e) => {
                const el = e.currentTarget;
                if (!im.width && el.naturalWidth) {
                  const next = images.slice();
                  next[i] = { ...im, width: el.naturalWidth, height: el.naturalHeight };
                  updateAttributes({ images: next });
                }
              }}
            />
            <div className="media-tools cell-tools" contentEditable={false}>
              <button type="button" title="Move left" disabled={i === 0} onMouseDown={stop} onClick={() => move(i, -1)}>
                <ChevronLeft className="size-3.5" />
              </button>
              <button type="button" title="Move right" disabled={i === images.length - 1} onMouseDown={stop} onClick={() => move(i, 1)}>
                <ChevronRight className="size-3.5" />
              </button>
              <button type="button" title="Remove from row" onMouseDown={stop} onClick={() => remove(i)}>
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
        <div className="media-tools row-tools" contentEditable={false}>
          {images.length < MAX_ROW_IMAGES && (
            <button type="button" title="Add another photo" onMouseDown={stop} onClick={add}>
              <ImagePlus className="size-3.5" />
            </button>
          )}
          <RadiusToggle radius={radius} onChange={(r) => updateAttributes({ radius: r })} />
        </div>
      </div>
      <figcaption className={caption || selected ? "visible" : ""}>
        <input
          value={caption}
          placeholder="Add a caption…"
          spellCheck={false}
          onChange={(e) => updateAttributes({ caption: e.target.value })}
        />
      </figcaption>
    </NodeViewWrapper>
  );
}
