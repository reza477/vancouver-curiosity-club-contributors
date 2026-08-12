WITH classified_meetup_events AS MATERIALIZED (
  SELECT event.id AS event_id,
         (
           SELECT lane.id
           FROM event_lanes AS lane
           WHERE lane.organization_id = event.organization_id
             AND lane.deleted_at IS NULL
             AND lane.slug = CASE
               WHEN instr(lower(event.title), 'meditat') > 0
                 OR instr(lower(event.title), 'journal') > 0
                 OR instr(lower(event.title), 'sketch') > 0
                 OR instr(lower(event.title), 'drawing') > 0
                 OR instr(lower(event.title), 'paint night') > 0
                 OR instr(lower(event.title), 'painting') > 0
                 OR instr(lower(event.title), 'poetry night') > 0
                 OR instr(lower(event.title), 'poetry circle') > 0
                 OR instr(lower(event.title), 'poem') > 0
                 OR instr(lower(event.title), 'silent reading') > 0
                 OR instr(lower(event.title), 'creative workshop') > 0
                 OR instr(lower(event.title), 'craft night') > 0
                 OR instr(lower(event.title), 'crafting') > 0
                 OR instr(lower(event.title), 'writing workshop') > 0
                 OR instr(lower(event.title), 'threshold ritual') > 0
                 OR instr(lower(event.title), 'reset') > 0
                 OR instr(lower(event.title), 'coworking') > 0
               THEN 'reset-and-make'
               WHEN instr(lower(event.title), 'paddleboard') > 0
                 OR instr(lower(event.title), 'hike') > 0
                 OR instr(lower(event.title), 'hiking') > 0
                 OR instr(lower(event.title), 'walk') > 0
                 OR instr(lower(event.title), 'beach sunset') > 0
                 OR instr(lower(event.title), 'cleveland dam') > 0
                 OR instr(lower(event.title), 'neighbourhood walk') > 0
                 OR instr(lower(event.title), 'neighborhood walk') > 0
                 OR instr(lower(event.title), 'city walk') > 0
                 OR instr(lower(event.title), 'outdoor outing') > 0
                 OR instr(lower(event.title), 'under the stars') > 0
               THEN 'explore'
               WHEN instr(lower(event.title), 'karaoke') > 0
                 OR instr(lower(event.title), 'latin dance') > 0
                 OR instr(lower(event.title), 'dance night') > 0
                 OR instr(lower(event.title), 'dancing night') > 0
                 OR instr(lower(event.title), 'dinner') > 0
                 OR instr(lower(event.title), 'lunch') > 0
                 OR instr(lower(event.title), 'brunch') > 0
                 OR instr(lower(event.title), 'restaurant') > 0
                 OR instr(lower(event.title), 'tasting') > 0
                 OR instr(lower(event.title), 'small plates') > 0
                 OR instr(lower(event.title), 'board game') > 0
                 OR instr(lower(event.title), 'games night') > 0
                 OR instr(lower(event.title), 'game night') > 0
                 OR instr(lower(event.title), 'mangos') > 0
               THEN 'eat-and-play'
               ELSE 'think'
             END
           LIMIT 1
         ) AS lane_id
  FROM events AS event
  WHERE event.event_lane_id IS NULL
    AND event.deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM external_source_links AS source_link
      WHERE source_link.organization_id = event.organization_id
        AND source_link.entity_type = 'event'
        AND source_link.entity_id = event.id
        AND source_link.source_type = 'meetup_ics'
        AND source_link.deleted_at IS NULL
    )
)
UPDATE events
SET event_lane_id = (
  SELECT classified.lane_id
  FROM classified_meetup_events AS classified
  WHERE classified.event_id = events.id
)
WHERE event_lane_id IS NULL
  AND id IN (
    SELECT classified.event_id
    FROM classified_meetup_events AS classified
    WHERE classified.lane_id IS NOT NULL
  );
