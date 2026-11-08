export default function RadiusToggle({ radius, onChange }: { radius: number; onChange: (r: number) => void }) {
  return (
    <button
      type="button"
      className="radius-toggle"
      contentEditable={false}
      title={radius ? "Square corners" : "Round corners"}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onChange(radius ? 0 : 12);
      }}
    >
      <span className="radius-icon" style={{ borderRadius: radius ? 4 : 1 }} />
    </button>
  );
}
