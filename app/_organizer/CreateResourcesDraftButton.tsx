"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  isRecord,
  organizerRequest,
  safeNotice,
} from "@/app/_organizer/client";
import styles from "@/app/_organizer/phase6.module.css";

export function CreateResourcesDraftButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createDraft() {
    setBusy(true);
    setError(null);
    try {
      const result = await organizerRequest(
        "/api/organizer/content/page",
        {
          body: JSON.stringify({
            snapshot: {
              blocks: [],
              metaDescription: "Resources from Vancouver Curiosity Club.",
              openGraphAssetId: null,
              seoTitle: "Resources",
              slug: "resources",
              title: "Resources",
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
        `/organizer/content/pages/${encodeURIComponent(
          result.entity.entity.entityKey,
        )}`,
      );
      router.refresh();
    } catch (caught) {
      setError(
        safeNotice(
          caught,
          "The Resources draft could not be created. No public page changed.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.noticeStack}>
      <button
        className={styles.button}
        disabled={busy}
        onClick={createDraft}
        type="button"
      >
        {busy ? "Creating draft…" : "Create Resources draft"}
      </button>
      <p className={styles.helpText}>
        This creates an unpublished, non-renamable Resources page. It remains
        absent from public navigation until you deliberately publish it.
      </p>
      {error ? (
        <p className={styles.errorNotice} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
