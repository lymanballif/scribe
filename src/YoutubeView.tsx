import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import RadiusToggle from "./RadiusToggle";

export default function YoutubeView({ node, updateAttributes }: NodeViewProps) {
  const radius: number = node.attrs.radius ?? 0;
  return (
    <NodeViewWrapper className="youtube-figure not-typeset" data-youtube-video="">
      <div className="media-frame">
        <iframe
          src={node.attrs.src}
          style={{ borderRadius: radius }}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          title="YouTube video"
        />
        <RadiusToggle radius={radius} onChange={(r) => updateAttributes({ radius: r })} />
      </div>
    </NodeViewWrapper>
  );
}
