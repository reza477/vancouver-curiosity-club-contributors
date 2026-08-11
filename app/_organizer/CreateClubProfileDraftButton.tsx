"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  isRecord,
  organizerRequest,
  safeNotice,
} from "@/app/_organizer/client";
import styles from "@/app/_organizer/phase6.module.css";

export type ClubProfileDraftOption = Readonly<{
  description: string | null;
  id: string;
  name: string;
  slug: string;
}>;

export type ClubProfileLaneOption = Readonly<{
  id: string;
  label: string;
}>;

export function CreateClubProfileDraftButton({
  clubs,
  lanes,
}: Readonly<{
  clubs: readonly ClubProfileDraftOption[];
  lanes: readonly ClubProfileLaneOption[];
}>) {
  const router = useRouter();
  const [clubId, setClubId] = useState(clubs[0]?.id ?? "");
  const [laneId, setLaneId] = useState(lanes[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const club = useMemo(
    () => clubs.find((candidate) => candidate.id === clubId) ?? null,
    [clubId, clubs],
  );

  async function create() {
    if (!club || !laneId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await organizerRequest(
        "/api/organizer/content/club_public_profile",
        {
          body: JSON.stringify({
            entityKey: club.id,
            snapshot: {
              contentConfirmed: false,
              coverAssetId: null,
              description: "",
              displayOrder: 1000,
              featured: false,
              imageAltText: null,
              laneId,
              meetupGroupUrl: null,
              metaDescription: "",
              name: club.name,
              openGraphAssetId: null,
              preparation: null,
              programType: "club",
              relatedResourceIds: [],
              seoTitle: club.name.slice(0, 60),
              slug: club.slug,
              socialUrls: [],
              summary: "",
              themeColor: "#2457D6",
              thumbnailAssetId: null,
              typicalFormat: null,
              whatToExpect: null,
            },
          }),
          method: "POST",
        },
      );
      if (
        !isRecord(result) ||
        !isRecord(result.entity) ||
        !isRecord(result.entity.entity) ||
        typeof result.entity.entity.entityKey !== "string"
      ) {
        throw new Error("invalid_cms_response");
      }
      router.push(
        `/organizer/content/clubs/${encodeURIComponent(
          result.entity.entity.entityKey,
        )}`,
      );
      router.refresh();
    } catch (caught) {
      setError(
        safeNotice(
          caught,
          "The private club-profile draft could not be created.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="club-draft-heading">
      <p className={styles.kicker}>Existing private club</p>
      <h2 id="club-draft-heading">Create a public-profile draft</h2>
      <p>
        This creates a private structured revision for an existing club. It
        does not publish the club or change its scheduling relationships.
      </p>
      {error ? (
        <div className={styles.errorNotice} role="alert">
          {error}
        </div>
      ) : null}
      <div className={styles.fieldGrid}>
        <label className={styles.field}>
          <span>Club or program</span>
          <select
            disabled={busy}
            onChange={(event) => setClubId(event.target.value)}
            value={clubId}
          >
            {clubs.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Initial public lane</span>
          <select
            disabled={busy}
            onChange={(event) => setLaneId(event.target.value)}
            value={laneId}
          >
            {lanes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.actionRow}>
        <button
          data-primary="true"
          disabled={busy || !club || !laneId}
          onClick={create}
          type="button"
        >
          {busy ? "Creating draft…" : "Create Club Profile Draft"}
        </button>
      </div>
    </section>
  );
}
