# Usage

## A first scan

Requires Node.js 22+. After verified npm publication, install with `npm install --global diskroom`, or use `npx diskroom`. From a source checkout, `node bin/diskroom.js` is equivalent to the executable.

```sh
diskroom scan ./projects --target-free 5GB
diskroom clean --scan <run-id>
```

The first command scans only and records an audit. The second opens the saved scan in a real terminal and asks you to review and explicitly confirm a specific plan. There is no unattended cleanup flag.

## Commands

| Command | Behavior |
| --- | --- |
| `diskroom` | Full interactive workflow. |
| `diskroom scan [path]` | Scan the selected scope and save a report. |
| `diskroom clean --scan <run-id>` | Review and confirm cleanup from a saved scan. |
| `diskroom history` | List saved runs in the current workspace. |
| `diskroom history <run-id>` | Inspect a saved run and any linked evidence. |
| `diskroom config [show]` | Show persistent workspace settings. |
| `diskroom config protect add\|remove <path>` | Add or remove an explicit protection. |
| `diskroom config exclude add\|remove <path>` | Add or remove a scan exclusion. |
| `diskroom config archive add\|remove <path>` | Add or remove an archive marker; hard protections still apply. |
| `diskroom config activity-days <days>` | Set the recent-activity threshold. |
| `diskroom about` | Product information and actual installed version. |
| `diskroom --help` | Usage and actual version. |
| `diskroom --version` | Actual installed package version. |

Use one value in place of `add|remove`; the vertical bar above describes alternatives and is not shell syntax to copy.

## Flags

| Flag | Meaning |
| --- | --- |
| `--scope cwd\|project\|disk\|system` | Directory, detected project, containing disk, or interactive local-volume selection. |
| `--path <path>` | Explicit scan path; equivalent to a positional path for `scan`. Conflicting paths are rejected. |
| `--target-free <size>` | Total desired free space, not bytes to delete. |
| `--workspace <path>` | Parent of `.diskroom`, independent of scan scope. |
| `--activity-days <days>` | Override the activity threshold for scan/wizard. To change a saved scan’s threshold, update config and create a new scan. |
| `--no-color` | Plain output without color. |
| `--json` | Structured `scan` and `history` output. Diagnostics remain on stderr. |

The target supports B, kB, MB, GB, KiB, MiB, GiB, and positive decimals. Decimal units are powers of 1,000; binary units powers of 1,024. `100kB` and `2.5GiB` are valid examples. A goal exceeding the volume’s capacity is rejected.

## Scope and workspace

The default directory is the original cwd. `project` detects an enclosing project; `disk` selects the local volume containing the selected path. `system` requires interactive volume selection and treats goals separately. It is not authorization to delete across every disk.

Caches outside the selected roots are not added silently. Links, additional mounts, network locations, and remote Docker storage do not expand the approved scope.

```sh
diskroom scan /path/to/projects --workspace /path/to/reports
diskroom history --workspace /path/to/reports
```

Both commands use `/path/to/reports/.diskroom`. Without the flag, the original cwd holds `.diskroom`. A disk scan does not silently move the audit to the disk root.

On Windows use a quoted ordinary native path or forward-slash form, for example:

```powershell
diskroom scan 'C:/Users/YourName/Projects' --target-free 5GB
```

## Keyboard controls

| Key | Action |
| --- | --- |
| Arrows / Tab | Move focus. |
| Space | Toggle a candidate. |
| Enter | Open detail or activate the focused action. |
| Escape | Go back/cancel. |
| `/` | Search paths/projects. |
| `f` | Filter candidate category. |
| `s` | Choose sorting. |
| `t` | Switch tree/list view. |
| `a` | Select visible recommended candidates only. |
| `n` | Clear selection. |
| `c` | Review the plan and continue toward confirmation. |
| `i` | Inspect largest directories, projects, and detector inventory. |
| `?` | Show keyboard help. |
| Ctrl+C | Interrupt further work; already completed changes are not undone. |

Opening a confirmation view does not approve cleanup. The final default is to decline. Risky choices can require acknowledgement of a specific candidate and its impact.

## Exit codes and scripts

| Code | Meaning |
| --- | --- |
| `0` | Completed, including no operations needed. |
| `1` | Invalid input, incomplete scan, runtime error, or operation errors. |
| `2` | Cleanup completed but did not meet the target. |
| `130` | Cancelled by the user. |

An informational scan does not return code 2 merely because cleaning would be needed. Use the report’s `status` and `issues` as well as the exit code.

```sh
diskroom scan ./projects --json > scan.json
diskroom history <run-id> --json > history.json
```

These exports may contain sensitive filesystem paths. They are not backup files or instructions to execute. Unknown audit schemas and malformed reports are rejected instead of interpreted as cleanup authority.
