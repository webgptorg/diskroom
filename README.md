# DiskRoom

**Goal-driven disk cleanup for developers.** Make the room you need, with context about what can be restored and what you still use.

DiskRoom is a local, interactive CLI. It scans a chosen scope, explains a conservative cleanup plan, and executes only explicitly confirmed operations. The goal means **total free space after cleanup**, not an additional amount to delete.

> [Source repository](https://github.com/webgptorg/diskroom) · [Publication and delivery status](docs/status.md) · [Platform verification](docs/platforms.md). Check the recorded status and test evidence for the version you intend to use.

## Install and run

Requires **Node.js 22.23.3+ and npm**, including for Python and Java projects. For a published release:

```sh
npm install --global diskroom
diskroom

# Or run without a global installation:
npx diskroom
```

Installation, help, and version output do not clean anything. There are no runtime npm dependencies. The release process packages a verified native filesystem safety bridge for supported targets; the published package must not require users to compile it. Scanning remains available when a compatible bridge is unavailable; Windows/macOS cleanup requires that bridge and otherwise fails closed.

```sh
# Scan only. The goal is 5 GB total free on the target volume.
diskroom scan ./projects --target-free 5GB

# Machine-readable scan; compressed local audit is still written.
diskroom scan ./projects --json

# Review a saved scan in an interactive terminal, then explicitly confirm.
diskroom clean --scan <run-id>

# Inspect the record of what happened.
diskroom history <run-id>
```

## How it decides

DiskRoom keeps three assessments separate:

- **Space:** logical size, measured allocation where available, and conservative estimated reclaimable bytes.
- **Recoverability:** the evidence that an artifact can be rebuilt or reinstalled, its assumptions, and its confidence.
- **Current need:** project activity, explicit protection, and available runtime/process signals.

The default plan uses only recommended candidates and stops selecting once the estimated goal is covered. Protected, unknown, and risky resources do not become expendable because they are large. Before each operation the engine checks fresh identity, activity, scope, and protection. After each operation it measures actual free space and stops starting new operations once the goal is reached.

If you have 0.4 GB free, want 2 GB, and an inactive project has 1.9 GB of eligible dependencies, that one environment may be enough. An active 4 GB environment stays protected and an unexplained 9 GB log stays unselected. These figures are illustrative, not a benchmark or promise.

## Actual capability boundary

Detection is not the same as executable cleanup. Read the complete [capability matrix](docs/capabilities.md).

| Family | Implemented execution boundary |
| --- | --- |
| Node.js | npm `node_modules` with complete installed-package membership and matching lock/registry metadata; additional content, scope, activity, and identity checks apply. Other manager layouts are detection-only. Probable build outputs and shared npm/pnpm/Yarn/Bun stores are detection-only. |
| Python | Evidenced virtual environments, strict bytecode caches with preserved adjacent source, and recognized pytest caches. Shared pip/uv stores are detection-only. |
| Java / JVM | Specific Maven/Gradle Java class directories where every class maps to preserved Java source. Shared Maven/Gradle stores are detection-only. |
| Runtime installations | Recognized manager layouts are detection-only; no runtime uninstallation. |
| Docker | Exact reviewed image removal or explicitly acknowledged stopped-container removal on a verified local daemon whose host storage is in scope and on the target volume. No force, broad prune, volume removal, or build-cache cleanup. |
| Git | On Linux, reviewed conservative local repacking that retains unreachable objects, with pinned filesystem handles, a temporary-space reserve, and preservation checks. macOS/Windows are detection-only. No pruning, reflog expiration, shallow replacement, remote mutation, or whole-project deletion. |
| Large files | Explicit review of large files and logs; never preselected for size. Only supported, revalidated file deletion can execute. |

The scanner does not run project scripts, install hooks, or shell fragments. Global stores outside the chosen scope are not silently included. Symlinks do not widen operations. Missing process visibility and unknown allocation are reported as uncertainty.

## Safety and audit

- Scanning changes no scanned artifacts. It writes compressed local audit records under `<workspace>/.diskroom`.
- The launch project, explicit protected paths, DiskRoom’s own runtime/program, and the active audit are protected.
- The default recent-activity threshold is 30 days. An archive marker does not override a live process or explicit protection.
- Cleanup requires a real terminal and an explicit final confirmation. There is no `--yes` or unattended cleanup mode.
- Direct deletion can be irreversible. The audit is **not a backup or an undo facility**. Network packages, credentials, local patches, and build inputs may be needed for restoration.
- A changed or unsupported resource is skipped/refused. Errors, interruptions, and unfinished operations remain visible in history.
- No telemetry or cloud service is required for local scanning. Audit paths and metadata may be sensitive; redact before sharing.

Process observation has platform and permission limits. A portable cleaner cannot guarantee visibility into every open file or dependency; a missing signal is not proof of inactivity. See [safety and recovery](docs/safety.md).

## More usage

```sh
# The audit workspace is independent of the scan scope.
diskroom scan /path/to/projects --workspace /path/to/reports

# A small or binary-unit goal works too.
diskroom scan ./projects --target-free 100kB
diskroom --target-free 2.5GiB

# Keep a path visible, but protected.
diskroom config protect add /path/to/important-project

# Omit a path from future scans in this workspace.
diskroom config exclude add /path/to/skip

# Mark an old project; hard protection still applies.
diskroom config archive add /path/to/old-project
diskroom config activity-days 60
```

Commands and controls: [CLI guide](docs/usage.md). Exit codes: `0` completed/no changes, `1` invalid input/runtime/incomplete/error, `2` cleanup finished below target, `130` cancelled. A scan with an unmet target is not a failed cleanup.

## Run the isolated example

From this source checkout:

```sh
node bin/diskroom.js --help
node examples/create-demo.mjs
node bin/diskroom.js scan <printed-demo-path> --json
```

The example creates a unique temporary directory containing tiny synthetic Node, Python, and JVM projects, an active project, and review-only data. It never downloads dependencies or deletes existing files. Read [the walkthrough](examples/README.md) before trying a cleanup. Before testing source cleanup, follow [development](docs/development.md) to build and verify the safety bridge. Linux also has a bounded descriptor-based backend; macOS/Windows cleanup requires the native bridge.

## Documentation

- [Getting started, commands, scope, and keyboard controls](docs/usage.md)
- [Exact detector and operation matrix](docs/capabilities.md)
- [Safety, restoration, and interruption recovery](docs/safety.md)
- [Compressed audit schema](docs/audit-format.md)
- [Current delivery status and remaining specification work](docs/status.md)
- [Platform verification](docs/platforms.md)
- [Development and static website](docs/development.md)
- [Original product specification](docs/product-specification.cs.md)

`web/` is a buildless documentation site with local assets and an interactive illustration. Its release manifest keeps publication, links, licensing, and platform status explicit. The browser does not access your disk.

## License and reporting

DiskRoom is licensed under the [MIT License](LICENSE), copyright © 2026 Pavol Hejný. For security issues follow [SECURITY.md](SECURITY.md); avoid posting unredacted audits in public issues.
