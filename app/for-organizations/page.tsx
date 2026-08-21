import type { Metadata } from "next";
import { Breadcrumbs } from "@/app/_components/Breadcrumbs";
import { PageMasthead } from "@/app/_components/PageMasthead";
import { PublicRouteLink as Link } from "@/app/_components/PublicRouteLink";

export const metadata: Metadata = {
  title: "For Organizations",
  description:
    "Ways organizations, venues, and supporters can work with Vancouver Curiosity Club.",
};

export default function ForOrganizationsPage() {
  return (
    <main className="for-organizations-page">
      <Breadcrumbs
        items={[
          { href: "/", label: "Home" },
          { label: "For Organizations" },
        ]}
      />
      <PageMasthead
        eyebrow="For organizations"
        title="Work with Vancouver Curiosity Club"
        deck="We welcome conversations with organizations, venues, funders, and supporters who want to help thoughtful public programs grow in Vancouver."
      />
      <section className="editorial-callout" aria-labelledby="organization-contact-title">
        <div>
          <p className="section-kicker">Start a conversation</p>
          <h2 id="organization-contact-title">Explore a partnership with us.</h2>
        </div>
        <Link className="primary-action" href="/contact?topic=partnerships">
          Discuss a partnership
        </Link>
      </section>
    </main>
  );
}
