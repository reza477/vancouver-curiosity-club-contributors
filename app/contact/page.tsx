import { notFound } from "next/navigation";
import {
  buildEditorialMetadata,
  EditorialUnavailable,
  loadEditorialPage,
} from "@/app/_components/EditorialPage";
import { ContactRouteBody } from "@/app/_components/EditorialRouteBodies";
import { PublicSubmissionForm } from "@/app/_components/PublicSubmissionForm";
import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readServerUtcMs } from "@/lib/server/clock";
import { ensureDatabaseInvariants } from "@/lib/server/database/invariants";
import { getRequestPublicOrganization } from "@/lib/server/public/request-cache";
import type { PublicFormKey } from "@/lib/server/phase7/public-form-contract";
import {
  createPublicFormInstanceToken,
  ensurePublicFormProtectionKey,
  readPublicFormProtectionKey,
} from "@/lib/server/phase7/public-form-protection";
import { writeSafeLog } from "@/lib/validation/server-observability";

const route = "/contact";
const slug = "contact";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return buildEditorialMetadata({
    descriptionOverride:
      "Contact Vancouver Curiosity Club about partnerships, events, accessibility, media, or another question.",
    fallbackTitle: "Contact",
    path: route,
    route,
    slug,
    titleOverride: "Contact",
  });
}

type PageSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export default async function ContactPage({
  searchParams,
}: Readonly<{ searchParams: PageSearchParams }>) {
  const params = await searchParams;
  const partnershipMode = params.topic === "partnerships";
  const [loaded, initialInstanceToken] = await Promise.all([
    loadEditorialPage(slug, route),
    preparePublicFormInstance("contact"),
  ]);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "unavailable") {
    return <EditorialUnavailable title="Contact" />;
  }

  return (
    <ContactRouteBody page={loaded.page} partnershipMode={partnershipMode}>
      <PublicSubmissionForm
        formKey="contact"
        id="contact-form"
        initialContactTopic={partnershipMode ? "Partnerships" : undefined}
        initialInstanceToken={initialInstanceToken}
      />
    </ContactRouteBody>
  );
}

async function preparePublicFormInstance(
  formKey: PublicFormKey,
): Promise<string | null> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await getRequestPublicOrganization(database);
    if (!organization) return null;
    const nowUtcMs = readServerUtcMs();
    let keyHex = await readPublicFormProtectionKey(
      database,
      organization.id,
    );
    if (keyHex === null) {
      const invariantStatus = await ensureDatabaseInvariants(database);
      if (invariantStatus !== "ready") return null;
      keyHex = await ensurePublicFormProtectionKey(
        database,
        organization.id,
        nowUtcMs,
      );
    }
    const { token } = await createPublicFormInstanceToken(
      keyHex,
      formKey,
      nowUtcMs,
    );
    return token;
  } catch {
    writeSafeLog("error", "public_contact_form_instance_unavailable", {
      code: "service_unavailable",
      operation: "prepare_public_contact_form",
      route,
      status: 503,
    });
    return null;
  }
}
