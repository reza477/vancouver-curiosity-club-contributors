"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  isRecord,
  organizerRequest,
  safeNotice,
} from "@/app/_organizer/client";
import type { ClubProfileLaneOption } from "@/app/_organizer/CreateClubProfileDraftButton";
import styles from "@/app/_organizer/phase6.module.css";

export type ProgramParentOption = Readonly<{
  id: string;
  laneId: string;
  name: string;
}>;

export function CreateProgramDraftButton({
  clubs,
  lanes,
}: Readonly<{
  clubs: readonly ProgramParentOption[];
  lanes: readonly ClubProfileLaneOption[];
}>) {
  const router = useRouter();
  const [clubId, setClubId] = useState(clubs[0]?.id ?? "");
  const selectedClub = useMemo(
    () => clubs.find((club) => club.id === clubId) ?? null,
    [clubId, clubs],
  );
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedClub || !name.trim() || !slug.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await organizerRequest(
        "/api/organizer/content/program_public_profile",
        {
          body: JSON.stringify({
            snapshot: {
              clubId: selectedClub.id,
              contentConfirmed: false,
              coverAssetId: null,
              description: "",
              displayOrder: 1000,
              featured: false,
              laneId: selectedClub.laneId,
              meetupGroupUrl: null,
              metaDescription: "",
              name,
              openGraphAssetId: null,
              preparation: null,
              programType: "program",
              relatedResourceIds: [],
              seoTitle: name.slice(0, 60),
              slug,
              socialUrls: [],
              summary: "",
              themeColor: "#0C665E",
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
        `/organizer/content/programs/${encodeURIComponent(
          result.entity.entity.entityKey,
        )}`,
      );
      router.refresh();
    } catch (caught) {
      setError(
        safeNotice(caught, "The private Program draft could not be created."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="program-draft-heading">
      <p className={styles.kicker}>Recurring activity within a club</p>
      <h2 id="program-draft-heading">Create a private Program draft</h2>
      <p>
        A Program organizes a recurring series beneath one canonical club. It
        remains private until its confirmed content is explicitly published.
      </p>
      {error ? (
        <div className={styles.errorNotice} role="alert">
          {error}
        </div>
      ) : null}
      <form className={styles.fieldGrid} onSubmit={create}>
        <label className={styles.field}>
          <span>Parent club</span>
          <select
            disabled={busy}
            onChange={(event) => setClubId(event.target.value)}
            value={clubId}
          >
            {clubs.map((club) => (
              <option key={club.id} value={club.id}>
                {club.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Public name</span>
          <input
            disabled={busy}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </label>
        <label className={styles.field}>
          <span>Stable nested slug</span>
          <input
            disabled={busy}
            maxLength={120}
            onChange={(event) => setSlug(event.target.value)}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            required
            value={slug}
          />
        </label>
        <label className={styles.field}>
          <span>Inherited scheduling lane</span>
          <input
            readOnly
            value={
              lanes.find((lane) => lane.id === selectedClub?.laneId)?.label ??
              "Unavailable"
            }
          />
        </label>
        <div className={styles.actionRow}>
          <button
            data-primary="true"
            disabled={busy || !selectedClub}
            type="submit"
          >
            {busy ? "Creating Program…" : "Create Program Draft"}
          </button>
        </div>
      </form>
    </section>
  );
}
