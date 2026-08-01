interface SectionHeaderProps { eyebrow: string; title: string; description?: string; align?: "left" | "center"; }

export function SectionHeader({ eyebrow, title, description, align = "center" }: SectionHeaderProps) {
  return <header className={`section-header section-header--${align}`}>
    <p className="eyebrow">{eyebrow}</p><h2>{title}</h2>{description && <p>{description}</p>}
  </header>;
}
