export type FieldArtworkTone =
  | "community"
  | "eat-play"
  | "explore"
  | "reset-make"
  | "think";

export function FieldArtwork({
  tone = "think",
}: Readonly<{ tone?: FieldArtworkTone }>) {
  return (
    <div className={`field-artwork field-artwork--${tone}`} aria-hidden="true">
      <span className="field-artwork__disc" />
      <span className="field-artwork__arc" />
      <span className="field-artwork__beam" />
      <span className="field-artwork__orbit" />
      <span className="field-artwork__satellite" />
      <span className="field-artwork__spark" />
      <span className="field-artwork__grain" />
    </div>
  );
}
