CREATE TRIGGER IF NOT EXISTS club_public_profiles_org_integrity_before_insert
BEFORE INSERT ON club_public_profiles
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizations AS organization
      INNER JOIN clubs AS club
        ON club.id = NEW.club_id
       AND club.organization_id = organization.id
      INNER JOIN event_lanes AS lane
        ON lane.id = NEW.primary_event_lane_id
       AND lane.organization_id = organization.id
      WHERE organization.id = NEW.organization_id
    )
    THEN RAISE(ABORT, 'club_public_profiles_organization_mismatch')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS club_public_profiles_org_integrity_before_update
BEFORE UPDATE OF club_id, organization_id, primary_event_lane_id
ON club_public_profiles
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizations AS organization
      INNER JOIN clubs AS club
        ON club.id = NEW.club_id
       AND club.organization_id = organization.id
      INNER JOIN event_lanes AS lane
        ON lane.id = NEW.primary_event_lane_id
       AND lane.organization_id = organization.id
      WHERE organization.id = NEW.organization_id
    )
    THEN RAISE(ABORT, 'club_public_profiles_organization_mismatch')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS clubs_public_profile_org_integrity_before_update
BEFORE UPDATE OF organization_id ON clubs
WHEN NEW.organization_id <> OLD.organization_id
 AND EXISTS (
   SELECT 1
   FROM club_public_profiles AS profile
   WHERE profile.club_id = OLD.id
     AND profile.organization_id <> NEW.organization_id
 )
BEGIN
  SELECT RAISE(ABORT, 'clubs_public_profile_organization_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS event_lanes_public_profile_org_integrity_before_update
BEFORE UPDATE OF organization_id ON event_lanes
WHEN NEW.organization_id <> OLD.organization_id
 AND EXISTS (
   SELECT 1
   FROM club_public_profiles AS profile
   WHERE profile.primary_event_lane_id = OLD.id
     AND profile.organization_id <> NEW.organization_id
 )
BEGIN
  SELECT RAISE(ABORT, 'event_lanes_public_profile_organization_mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS event_public_details_org_integrity_before_insert
BEFORE INSERT ON event_public_details
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizations AS organization
      INNER JOIN events AS event
        ON event.id = NEW.event_id
       AND event.organization_id = organization.id
      WHERE organization.id = NEW.organization_id
    )
    THEN RAISE(ABORT, 'event_public_details_organization_mismatch')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS event_public_details_org_integrity_before_update
BEFORE UPDATE OF event_id, organization_id ON event_public_details
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM organizations AS organization
      INNER JOIN events AS event
        ON event.id = NEW.event_id
       AND event.organization_id = organization.id
      WHERE organization.id = NEW.organization_id
    )
    THEN RAISE(ABORT, 'event_public_details_organization_mismatch')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS events_public_details_org_integrity_before_update
BEFORE UPDATE OF organization_id ON events
WHEN NEW.organization_id <> OLD.organization_id
 AND EXISTS (
   SELECT 1
   FROM event_public_details AS detail
   WHERE detail.event_id = OLD.id
     AND detail.organization_id <> NEW.organization_id
 )
BEGIN
  SELECT RAISE(ABORT, 'events_public_details_organization_mismatch');
END;
--> statement-breakpoint
UPDATE club_public_profiles
SET organization_id = organization_id
WHERE NOT EXISTS (
  SELECT 1
  FROM organizations AS organization
  INNER JOIN clubs AS club
    ON club.id = club_public_profiles.club_id
   AND club.organization_id = organization.id
  INNER JOIN event_lanes AS lane
    ON lane.id = club_public_profiles.primary_event_lane_id
   AND lane.organization_id = organization.id
  WHERE organization.id = club_public_profiles.organization_id
);
--> statement-breakpoint
UPDATE event_public_details
SET organization_id = organization_id
WHERE NOT EXISTS (
  SELECT 1
  FROM organizations AS organization
  INNER JOIN events AS event
    ON event.id = event_public_details.event_id
   AND event.organization_id = organization.id
  WHERE organization.id = event_public_details.organization_id
);
