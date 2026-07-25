import {
  FieldArtwork,
  type FieldArtworkTone,
} from "./FieldArtwork";

export function PageMasthead({
  deck,
  eyebrow,
  title,
  tone,
}: Readonly<{
  deck: string;
  eyebrow: string;
  title: string;
  tone?: FieldArtworkTone;
}>) {
  return (
    <header className="page-masthead">
      <div className="page-masthead__copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-masthead__deck">{deck}</p>
      </div>
      <FieldArtwork tone={tone} />
    </header>
  );
}
