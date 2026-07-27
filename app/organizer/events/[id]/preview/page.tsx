import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicEventDetailRenderer } from "@/app/_components/PublicEventDetailRenderer";
import {
  enforceOrganizerPageAccess,
  loadOrganizerPageContext,
} from "@/app/_organizer/access";
import { OrganizerPageState } from "@/app/_organizer/OrganizerRouteState";
import styles from "@/app/_organizer/workspace.module.css";
import { readOrganizerPublicationPreview } from "@/lib/server/organizer/publication";
import {
  SafeApplicationError,
  writeSafeLog,
} from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Protected website preview",
  alternates: {},
  openGraph: null,
  robots: {
    follow: false,
    index: false,
    noarchive: true,
    nocache: true,
    noimageindex: true,
  },
  twitter: null,
};

type RouteParams = Promise<{ id: string }>;

export default async function OrganizerEventPreviewPage({
  params,
}: Readonly<{ params: RouteParams }>) {
  const { id } = await params;
  const route = `/organizer/events/${encodeURIComponent(id)}/preview`;
  const loaded = await loadOrganizerPageContext(route);
  enforceOrganizerPageAccess(loaded);
  if (loaded.kind !== "granted") return <AccessChanged />;

  let event: Awaited<ReturnType<typeof readOrganizerPublicationPreview>> | null =
    null;
  let failed = false;
  try {
    event = await readOrganizerPublicationPreview(
      loaded.context.database,
      loaded.context.identity,
      id,
    );
  } catch (error) {
    if (error instanceof SafeApplicationError && error.status === 404) {
      notFound();
    }
    writeSafeLog("error", "organizer_preview_failed", {
      code: "internal_error",
      route: "/organizer/events/[id]/preview",
      status: 500,
    });
    failed = true;
  }
  if (failed) {
    return (
      <OrganizerPageState
        detail="No public event facts are being guessed. Return to the event and try again."
        heading="Protected preview temporarily unavailable."
        tone="error"
      />
    );
  }
  if (!event) notFound();
  return (
    <>
      <aside
        aria-labelledby="private-preview-title"
        className={styles.previewBanner}
      >
        <div>
          <p className={styles.kicker}>Protected preview</p>
          <h1 id="private-preview-title">Not a public page</h1>
          <p>
            This private, no-store preview uses the same allowlisted event
            renderer as the website. It is not indexed, shared, or added to the
            sitemap.
          </p>
        </div>
        <Link href={`/organizer/events/${encodeURIComponent(id)}`}>
          Return to event
        </Link>
      </aside>
      <PublicEventDetailRenderer
        canonicalUrl={null}
        event={event}
        showShareControls={false}
      />
    </>
  );
}

function AccessChanged() {
  return (
    <OrganizerPageState
      detail="Your active membership could not be revalidated for this request."
      heading="Organizer access changed."
      tone="error"
    />
  );
}
