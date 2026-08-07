export type PageMastheadTone =
  | "community"
  | "eat-play"
  | "explore"
  | "reset-make"
  | "think";

export function PageMasthead({
  deck,
  eyebrow,
  title,
  tone,
}: Readonly<{
  deck: string;
  eyebrow: string;
  title: string;
  tone?: PageMastheadTone;
}>) {
  return (
    <header
      className="page-masthead page-masthead--compact"
      data-masthead-tone={tone ?? "think"}
    >
      <div className="page-masthead__copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-masthead__deck">{deck}</p>
      </div>
      <div className="page-masthead__accent" aria-hidden="true">
        <span />
      </div>
    </header>
  );
}
