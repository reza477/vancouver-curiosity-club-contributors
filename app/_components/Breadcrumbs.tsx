import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";

export type BreadcrumbItem = Readonly<{
  href?: string;
  label: string;
}>;

export function Breadcrumbs({
  items,
}: Readonly<{ items: readonly BreadcrumbItem[] }>) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`}>
              {item.href && !isCurrent ? (
                <Link href={item.href}>
                  {item.label}
                </Link>
              ) : (
                <span aria-current={isCurrent ? "page" : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
