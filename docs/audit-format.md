# Compressed audit format, schema 1

Every durable run part is a gzip-compressed UTF-8 JSON object. Workspace configuration is plain JSON at `<workspace>/.diskroom/config.json`; run records live under `<workspace>/.diskroom/runs/<run-id>/`.

A run ID is a kind prefix (`scan-`, `clean-`, or `plan-`) followed by a UUID. Scan and cleaning have separate IDs; cleaning references `scanId` and `planId`. A run is not identified by its timestamp alone.

## Common part fields

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Integer `1`; unknown versions are rejected. |
| `runId` | Owning run ID. |
| `part` | Stable logical part name, matching the file stem. |
| `sequence` | Monotonically increasing durable write sequence within the run. A rewritten part has a newer sequence. |
| `writtenAt` | ISO timestamp of the write. |

Parts contain their own payload fields alongside these common fields, not inside a mandatory `data` envelope. `summary.json.gz` is atomically replaced as the run progresses. Independently closed inventory/journal chunks survive interruption. File names and timestamps alone do not imply an operation’s success.

## Summary fields

Run summaries include `id`, `kind`, `status`, `workspace`, `auditPath`, `startedAt`, `finishedAt` when available, version information, and environment context. Scan summaries include:

- `cwd`, `roots`, `targetFree`, and `activityDays`;
- the target `volume` with identity/root, total bytes, and user-available free bytes;
- `freeAfterBytes` as observed after scanning;
- detector `plugins`, discovered `projects`, aggregate `directories`, `issues`, and `candidates`;
- status `complete`, `incomplete`, `cancelled`, or `failed`; an in-progress snapshot may say `running`.

A scan’s after-measurement is an observation, not a claim that no other process changed the disk.

## Candidate fields

| Field | Meaning |
| --- | --- |
| `id`, `path`, `project` | Candidate identity, absolute normalized path, and owning project if identified. |
| `resourceId` | Exact manager-resource identity when applicable; Docker resources can share a storage path but have distinct IDs. |
| `ecosystem`, `category` | Detector family and artifact kind. |
| `operation` | Supported operation identifier or `detect-only`. Schema recognition is not proof that the executor implements every operation. |
| `status` | `recommended`, `review`, `risky`, or `protected`. |
| `logicalBytes` | Logical content size. |
| `allocatedBytes`, `reclaimableBytes` | Measured allocation and conservative reclaim estimate; `null` means unknown. |
| `safety`, `need` | Separate `{score, confidence, reasons}` objects. Score is 0–100 or `null`; confidence is high/medium/low. |
| `reasons`, `restore`, `risks`, `protection` | Human-readable evidence, restoration assumptions, risks, and prohibitions. |
| `fingerprint` | Filesystem identity/metadata used for revalidation; not authorization by itself. |
| `activityAt`, `manager`, `metadata` | Optional supporting evidence and detector-specific data. |

A stored score is a heuristic, not a probability. The executor distrusts edited reports, unknown actions, invalid scopes, malformed identifiers, and unsupported schemas. It checks evidence against a fresh view rather than treating the audit as signed authority.

## Plans and operation journals

A plan records `id`, `scanId`, `selectedIds`, `targetFree`, conservative `estimatedBytes`, and `createdAt`. The confirmed plan includes explicit approval metadata and any per-candidate risk acknowledgements.

Before an operation, bounded inventory chunks record the exact candidate contents and identities. Journal parts use an intent/result pairing, for example:

```text
operation-inventory-… .json.gz
intent-operation-… .json.gz
result-operation-… .json.gz
```

The ellipses illustrate sequence-bearing names; use the actual `auditParts` returned by history. The inventory is bounded in chunks, not one huge uncompressed disk listing. Intent is durably written before deletion. A result contains `complete` and an `entries` array; each entry records a `relativePath`, `status`, timestamp, and an error where applicable. The result is durably updated as entries complete. Manager actions instead record their exact resource/command and available post-operation verification; they do not claim an individual-file inventory of a daemon-owned resource.

An absent result or `complete !== true` leaves the associated intent unverified. `readRun` exposes these as `unresolvedIntents` with recovery guidance. If a summary is still `running`, history marks it interrupted. It does not infer success from the absence of a file after a crash.

Clean summaries link the scan/plan, describe operations actually attempted, distinguish completed/skipped/failed/partial work, and record free-space observations. A selected but unstarted operation is not an executed deletion.

## Read a part without extra packages

```sh
node --input-type=module -e "import{readFileSync}from'node:fs';import{gunzipSync}from'node:zlib';console.log(gunzipSync(readFileSync(process.argv[1])).toString())" "/path/to/summary.json.gz"
```

Or use `diskroom history <run-id> --json` for validated history with recovery annotations. Audit readers use bounded decompression and reject malformed run IDs, part names, paths, and unknown schema values. Do not use a raw report as a shell script or editing it as a way to authorize cleanup.

## Durability and privacy

Parts are written to a private temporary file, synced, atomically renamed, and the containing directory is synced where the platform permits. Windows directory syncing differs from POSIX; the file itself is synced. Filesystem/storage failures can still interrupt writes. Failure to write required audit evidence stops further destructive work.

Audit is metadata, not removed-file content and not a backup. It can include sensitive paths and host metadata. Keep it local or redact before sharing. DiskRoom does not automatically upload it.
