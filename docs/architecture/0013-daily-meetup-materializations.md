# ADR 0013: Daily Meetup sync and durable public event materializations

## Status

Accepted.

## Decision

GitHub Actions invokes a private, POST-only Sites endpoint every day at 04:17
America/Vancouver. Every request carries a five-minute timestamp, a canonical
UUID, and an HMAC-SHA-256 signature over the exact timestamp, UUID, and body.
The endpoint claims that UUID in D1 before doing work, so a replay cannot run a
second import. The same secret lives only in the GitHub and Sites secret
stores.

One HTTP request advances at most one existing two-event Meetup import slice.
This preserves the established D1 statement ceiling. GitHub repeats freshly
signed calls, with a hard invocation limit, until all configured sources are
current. Partial or failed generations never replace the previous active
generation.

After a terminal all-current result, the updater runs one bounded unified
public-event projection. It validates and atomically promotes a durable Home
event rail and the full supported Events-calendar window. Home and Events
visitor loaders perform indexed reads of that last-known-good materialization;
they cannot call the Meetup importer, run the heavy public-event projection,
or write a replacement snapshot.

## Reporting and failure behavior

The endpoint returns only allowlisted status, timestamps, and aggregate counts.
It never returns source URLs, event identifiers, credentials, or raw errors.
GitHub Actions fails on authentication, HTTP, response-shape, importer,
materialization, or safety-limit failures and writes one counts-only job
summary. The previous active Meetup generation and public materialization stay
available after every failure.

## Manual operation

Owner and Administrator manual refresh remains available for urgent source
changes. The daily workflow can also be dispatched manually. Neither path
allows an ordinary visitor request to advance event synchronization.
