# CLI reference

`diskroom` opens the keyboard wizard. `diskroom scan [path]` only scans. `diskroom clean --scan <run-id>` loads a scan from the selected audit workspace and requires a terminal, a reviewed plan and final confirmation. `diskroom history [run-id]` reads audit history. Help, version and history never initiate a scan.

Shared options: `--scope cwd|project|disk|system`, `--path <path>`, `--target-free <size>`, `--workspace <path>`, `--activity-days <positive integer>`, `--no-color`. Scope, path and activity-window overrides apply to scan/wizard. Target applies to scan/wizard/clean. `--json` applies only to scan/history. `--scope system` requires interactive explicit volume selection and handles each chosen volume as its own target and scan. Use an explicit disk path per invocation for noninteractive scans.

Targets mean total free space after cleanup. Units are decimal B/kB/MB/GB/TB or binary KiB/MiB/GiB/TiB. Decimal values are accepted. Scanning never requires an npm account or cloud connection.

## Keyboard

- Up/Down/Tab: focus. Enter: choose or open details. Space: toggle selection. Escape: go back or exit without approval. Ctrl+C: stop further work and preserve reachable audit state.
- Report: `/` searches path/project/ID, `f` filters category, `s` selects sorting, `t` switches expandable project tree/list, `a` selects visible recommended eligible findings, `n` clears selection, `c` reviews the exact plan, `i` opens directory/project inventory, `?` shows keys. In tree view, Left/Right collapses/expands a project.
- Detail: Up/Down/PageUp/PageDown/Home/End scroll. Unknown quantities remain explicitly unknown.
- Final confirmation defaults to **NO**. Findings marked review or risky additionally require the exact candidate ID. There is no `--yes` and no noninteractive cleanup.

## Local configuration

```bash
diskroom config show
diskroom config protect add /path/to/important-project
diskroom config protect remove /path/to/important-project
diskroom config exclude add /path/to/unavailable-tree
diskroom config archive add /path/to/old-project
diskroom config archive remove /path/to/old-project
diskroom config activity-days 60
```

Rules are stored as absolute paths in `<workspace>/.diskroom/config.json`. `--workspace` chooses the folder containing `.diskroom`; it does not change scan scope. Exclusion prevents scanning a tree. Protection prevents cleanup. Archiving is only an explicit activity annotation; it does not establish recoverability or waive other protections. The activity window defaults to 30 days.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Completed; includes read-only scan, already met goal, or exit without approved changes |
| 1 | Invalid input, runtime error, incomplete scan or failed cleanup operation |
| 2 | Cleanup completed but actual volume free space has not reached the target |
| 130 | Interrupted by user |

Scanning with an unmet target is still a successful scan when complete. No cleanup was attempted. Technical errors take precedence over an unmet target. All persistent scan, plan revision and cleanup records are compressed JSON; an audit is not a backup or general undo.
