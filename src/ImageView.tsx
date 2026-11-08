import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Columns2, Trash2 } from "lucide-react";
import RadiusToggle from "./RadiusToggle";
import { pickImageFiles } from "./pickFiles";
import { prepareImages } from "./images";
import type { RowImage } from "../shared/articleExtensions";

export default function ImageView({ node, updateAttributes, selected, editor, getPos, deleteNode }: NodeViewProps) {
  const caption: string = node.attrs.caption ?? "";
  const radius: number = node.attrs.radius ?? 0;

  const addBeside = async () => {
    const files = await pickImageFiles(true);
    if (!files.length) return;
    const prepared = await prepareImages(files);
    if (!prepared.length) return;
    const pos = getPos();
    if (pos === undefined) return;
    const first: RowImage = {
      src: node.attrs.src,
      alt: node.attrs.alt ?? "",
      width: node.attrs.width ?? undefined,
      height: node.attrs.height ?? undefined,
    };
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .insertContentAt(pos, {
        type: "imageRow",
        attrs: { images: [first, ...prepared].slice(0, 4), caption, radius },
      })
      .run();
  };

  return (
    <NodeViewWrapper as="figure" className={"image-figure not-typeset" + (selected ? " selected" : "")}>
      <div className="media-frame">
        <img
          src={node.attrs.src}
          alt={node.attrs.alt ?? caption}
          width={node.attrs.width ?? undefined}
          height={node.attrs.height ?? undefined}
          draggable="false"
          style={{ borderRadius: radius }}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (!node.attrs.width && img.naturalWidth) {
              updateAttributes({ width: img.naturalWidth, height: img.naturalHeight });
            }
          }}
        />
        <div className="media-tools" contentEditable={false}>
          <button type="button" title="Add a photo beside this one" onMouseDown={(e) => e.preventDefault()} onClick={addBeside}>
            <Columns2 className="size-3.5" />
          </button>
          <RadiusToggle radius={radius} onChange={(r) => updateAttributes({ radius: r })} />
          <button type="button" title="Remove photo" onMouseDown={(e) => e.preventDefault()} onClick={() => deleteNode()}>
            <Trash2 className="size-3.5" />
          </button>
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
