import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import RadiusToggle from "./RadiusToggle";

export default function ImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const caption: string = node.attrs.caption ?? "";
  const radius: number = node.attrs.radius ?? 0;
  return (
    <NodeViewWrapper as="figure" className={"image-figure not-typeset" + (selected ? " selected" : "")}>
      <div className="media-frame">
        <img src={node.attrs.src} alt={node.attrs.alt ?? caption} draggable="false" style={{ borderRadius: radius }} />
        <RadiusToggle radius={radius} onChange={(r) => updateAttributes({ radius: r })} />
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
