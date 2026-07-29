# Phase 7 event CSV template and field guide

Template version: `v1`
Parser version: `v1`

Download the UTF-8 template at `/templates/vcc-event-import-v1.csv`. It
contains the canonical header row and no fabricated events or personal
information.

## Safety and scope

The importer accepts one local `.csv` file. It does not accept remote URLs,
Excel workbooks, JSON, ICS, XML, HTML, ZIP files, executables, or other
archives. CSV files may be UTF-8 with or without a UTF-8 BOM and may use
standard RFC 4180 quoting for commas, quotes, and embedded line breaks.

The limits are:

- 2 MiB per file;
- 40 columns;
- 2,000 nonblank data rows;
- 32 KiB per normalized mapped row;
- 10,000 Unicode characters per cell.

Unmapped columns are ignored and are not retained. The original upload is not
stored in media storage. Import preview stores only the file hash, provenance,
allowlisted mapped cells, normalized preview, and result facts.

Imports create private organizer records only. They never populate a public
description, never publish an event, and never bypass the normal publishing
workflow.

## Mapping

The official header names map automatically by exact match. For a different
CSV, map each uploaded header to one canonical field or choose **Ignore**. A
canonical field may be mapped only once.

These mappings are required:

- `title`
- `club`
- `schedule_type`
- `planning_status`
- `primary_organizer_email`
- `attendance_mode`

Club, Program, lane, category, location, and organizer values are resolved
against active records in the current organization during preview. A
reference may be an allowed ID, slug, or unambiguous normalized name where the
preview explicitly supports that form. Organizer matching uses membership
email, never display name. Imports do not create taxonomy, venues, programs,
clubs, profiles, memberships, or invitations.

## Canonical fields

| Column | Rules |
| --- | --- |
| `external_id` | Optional source identifier. When supplied, the import also requires a bounded source namespace. Namespace plus source type plus external ID is a cross-batch duplicate key and never overwrites an event. |
| `title` | Required. Plain text, at most 180 characters. |
| `club` | Required active same-organization Club reference. |
| `program` | Optional active same-organization Program reference. |
| `lane` | Optional active same-organization event-lane reference. |
| `category` | Optional active same-organization category reference. |
| `schedule_type` | Required: `unscheduled`, `timed`, or `all_day`. Only an `idea` may be unscheduled. |
| `start_date` | Timed/all-day local start date in `YYYY-MM-DD`. |
| `start_time` | Timed local start time in `HH:MM` or `HH:MM:SS`. |
| `start_utc_offset` | Optional `+HH:MM` or `-HH:MM`. Required when the start time occurs twice at a daylight-saving transition. It must match the timezone. |
| `end_date` | Timed local end date in `YYYY-MM-DD`. Overnight and multi-day ranges are allowed when the end is later than the start. |
| `end_time` | Timed local end time in `HH:MM` or `HH:MM:SS`. |
| `end_utc_offset` | Optional `+HH:MM` or `-HH:MM`. Required when the end time occurs twice and must match the timezone. |
| `end_date_exclusive` | Required for `all_day`; the day after the final included date. Do not use it for timed events. |
| `timezone` | IANA timezone. Blank visibly defaults to `America/Vancouver`. Fixed offsets such as `UTC-7` are invalid. |
| `planning_status` | Required: `idea`, `draft`, `tentative_hold`, or `confirmed`. New imports cannot be `cancelled`, `completed`, or `archived`. |
| `publication_status` | Optional. Blank visibly defaults to `private`; `private` is the only accepted value. |
| `primary_organizer_email` | Required active or invited same-organization membership email. |
| `co_organizer_emails` | Optional. Separate up to 12 membership emails with `|`. Repeated co-organizer addresses are normalized to one deterministic entry. Do not repeat the primary organizer. |
| `location` | Optional active same-organization venue reference. It never carries private venue instructions. |
| `attendance_mode` | Required: `in_person`, `online`, `hybrid`, or `undecided`. |
| `meetup_url` | Optional public HTTPS Meetup event URL. Tracking parameters and fragments are removed. Private source-feed addresses are never accepted here. |
| `notes` | Optional private internal notes. This value never becomes public description text automatically. |
| `buffer_before_minutes` | Optional whole minutes from 0 through 1,440. Blank defaults to `0`. |
| `buffer_after_minutes` | Optional whole minutes from 0 through 1,440. Blank defaults to `0`. |

## Date and timezone behavior

Timed rows require real local start and end values plus an IANA timezone. The
preview converts them to UTC without hardcoding Vancouver's offset. A local
time in a spring daylight-saving gap is rejected. A local time that occurs
twice during the fall transition requires the matching offset, for example
`-07:00` for the earlier Vancouver occurrence or `-08:00` for the later one.

All-day rows use `start_date` and `end_date_exclusive`. A one-day event ending
on July 24 therefore uses a July 23 start and July 24 exclusive end.

## Publication and duplicate policy

Blank publication status becomes `private`. Any request for `scheduled`,
`published`, or `unpublished` is rejected with this explanation:

> Imports never publish events. Review the imported private event and use the normal publishing workflow.

The preview is non-authoritative. It identifies hard duplicates, possible
semantic duplicates, mapping changes, and schedule conflicts. Hard duplicates
are skipped and never overwrite. A possible semantic duplicate defaults to
Skip; an Owner or Administrator must explicitly choose Create Separate Event
and give a reason. Application reloads the stored preview and rechecks current
authorization, mappings, duplicates, and the authoritative conflict policy.

## Spreadsheet-looking source text

CSV input is parsed as text; values beginning with spreadsheet formula
characters are never executed by the importer. Export routines separately
neutralize spreadsheet formula prefixes before producing a downloadable CSV.

## Authorized cut

**ICS file import — Not implemented — authorized cut.**

This cut does not affect one-event ICS downloads, public ICS export, the
read-only private calendar subscription, or the existing official Meetup
iCalendar feed workflow.
