import assert from "node:assert/strict";
import test from "node:test";
import {
  eventEditorApiInput,
  reconcileEventEditorClubSelection,
} from "../../app/_organizer/event-editor-state.ts";

function editorValue(overrides = {}) {
  return {
    allDayEndDateExclusive: "",
    allDayStartDate: "",
    categoryId: "",
    cleanupBufferMinutes: 0,
    clubId: "club-a",
    coOrganizerProfileIds: [],
    endDate: "2026-08-15",
    endTime: "20:30",
    expectedEditVersion: 4,
    internalNotes: "",
    laneId: "",
    meetupEventUrl: "",
    planningStatus: "draft",
    primaryOrganizerProfileId: "profile-admin",
    privateMeetingDetails: null,
    programId: "program-a",
    publicDescription: "",
    publicSummary: "",
    scheduleShape: "timed",
    setupBufferMinutes: 0,
    startDate: "2026-08-15",
    startTime: "18:30",
    timezone: "America/Vancouver",
    title: "Private Draft",
    venueId: null,
    ...overrides,
  };
}

test("editor payload round-trips adopted venue and private meeting values", () => {
  const payload = eventEditorApiInput(
    editorValue({
      privateMeetingDetails: "PRIVATE-MEETING-ROUNDTRIP",
      venueId: "venue-existing",
    }),
  );
  assert.equal(payload.venueId, "venue-existing");
  assert.equal(
    payload.privateMeetingDetails,
    "PRIVATE-MEETING-ROUNDTRIP",
  );
});

test("moving a Draft between clubs removes stale organizer assignments", () => {
  const organizers = [
    {
      clubs: [],
      id: "profile-admin",
      label: "Administrator",
      organizationWide: true,
    },
    {
      clubs: [],
      id: "profile-owner",
      label: "Owner",
      organizationWide: true,
    },
    {
      clubs: ["club-a"],
      id: "profile-club-a",
      label: "Club A",
      organizationWide: false,
    },
    {
      clubs: ["club-b"],
      id: "profile-club-b",
      label: "Club B",
      organizationWide: false,
    },
  ];
  const moved = reconcileEventEditorClubSelection(
    editorValue({
      coOrganizerProfileIds: [
        "profile-owner",
        "profile-club-a",
        "profile-club-b",
      ],
    }),
    "club-b",
    organizers,
    "profile-owner",
  );

  assert.equal(moved.clubId, "club-b");
  assert.equal(moved.programId, "");
  assert.equal(
    moved.primaryOrganizerProfileId,
    "profile-admin",
    "an organization-wide primary remains valid",
  );
  assert.deepEqual(moved.coOrganizerProfileIds, [
    "profile-owner",
    "profile-club-b",
  ]);

  const fallback = reconcileEventEditorClubSelection(
    editorValue({
      primaryOrganizerProfileId: "profile-club-a",
      coOrganizerProfileIds: ["profile-owner", "profile-club-a"],
    }),
    "club-b",
    organizers,
    "profile-owner",
  );
  assert.equal(fallback.primaryOrganizerProfileId, "profile-owner");
  assert.deepEqual(fallback.coOrganizerProfileIds, []);
});
