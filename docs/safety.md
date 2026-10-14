# Safety and recovery

DiskRoom is a tool for deliberate local cleanup, not a backup system. Direct deletion may be irreversible. It does not provide a general undo, reinstall removed environments automatically, stop running applications, elevate privileges, or broaden a plan after confirmation.

## What a scan changes

Only the audit and necessary DiskRoom state are written during a scan. The scanner treats project configuration as data, never executes project scripts or installation hooks, and does not follow links to expand scope. There is no telemetry or cloud service requirement. Remote Git verification and remote data mutation are not performed.

The scan reports omissions and uncertainty. Unreadable directories, missing process access, changed mounts, and detector errors do not imply empty directories or inactive resources.

## How an item becomes actionable

1. A built-in detector recognizes a specific supported artifact using context, not only a name.
2. The scanner records restoration evidence, activity/protection, identities, and a conservative space estimate.
3. The user reviews a plan for a particular target volume and explicitly confirms it in a real terminal.
4. The executor validates the report and confirmed plan and obtains a per-user cleanup lock.
5. Before each operation, fresh checks verify the scope, current configuration, activity, target identity, and supported artifact structure.
6. The executor durably records the operation intent before touching any file, records results, and measures actual free space.

Changed, newly used, unsupported, protected, or unverifiable resources are refused or skipped. A large goal cannot override these checks. A selected plan may finish short of its goal.

## Protection versus exclusion

Protection preserves visibility but disallows deletion. Exclusion omits a path from scanning. Archive markers only affect soft activity interpretation; they do not override running-process use, explicit protection, sensitive content, DiskRoom’s runtime, or its own audit workspace.

The current launch project is protected. The default recent-activity window is 30 days. Cleanup uses at least the current workspace policy even if an older scan recorded a shorter period; change configuration deliberately and rescan to change that policy. Filesystem age alone is not a proof of restoration or inactivity.

## Process and filesystem limits

Linux inspects observable same-user `/proc` cwd, executables, file descriptors, and applicable absolute argument paths. macOS uses trusted system `lsof` for available same-user cwd, executable/text mappings, and open-file paths. Windows uses native system-directory discovery and system PowerShell/CIM to inspect same-user executables and whole absolute command-line argument paths; cwd, open handles, relative arguments, and embedded command syntax are not resolved. Raw command lines are discarded. macOS/Windows coverage remains partial and never enables automatic recommendation. Missing helpers, permission restrictions, time limits, and output limits are reported.

Process checks run again after inventory and periodically during filesystem deletion. They are point-in-time observations, not complete visibility across permissions, containers, every runtime reference, or concurrent activity. No snapshot can prevent a process opening a file immediately afterwards.

Logical bytes, allocation, and exclusive reclaimable bytes differ. Hardlinks can keep content allocated elsewhere. Shared and unknown storage is not credited as certain savings. Another process may change free space while DiskRoom runs, so before/after measurements are observations rather than uniquely attributable savings.

The executor uses bounded, non-following operations and identity checks, with native safety support where required. Unsupported native-platform execution fails closed. Portable code cannot offer universal transactional guarantees against a hostile local user concurrently changing the filesystem. Do not run cleanup over a tree that an untrusted user can mutate and treat it as a security sandbox.

## What happens after interruption

Ctrl+C stops starting further work and attempts to preserve the current record. It cannot undo files already removed. A partially removed environment may need complete reinstallation.

Read the relevant run:

```sh
diskroom history <run-id> --json
```

`unresolvedIntents` means a durable intent lacks a completed durable result. A summary still marked `running` is also incomplete. Neither state is assumed successful. Do not turn an intent into a success record by hand.

Each clean run holds a per-user lock in the platform temporary directory. Concurrent cleanup is refused. A stale lock is not permission to resume unfinished deletion. Check that no DiskRoom process is still running, inspect the associated audit, and investigate the cause before removing a confirmed stale lock. If uncertain, leave the lock and report the issue with redacted evidence. DiskRoom never resumes destructive work automatically.

If audit writes fail, no further destructive operation starts. Choose another explicitly approved writable workspace and rescan once the issue is resolved. Do not edit an old scan to force a new target or skip revalidation.

## Restoration is an independent action

| Removed artifact | Typical restoration | Important assumptions |
| --- | --- | --- |
| npm dependencies | Run `npm ci` in the preserved project. | Lockfile and manifest match; packages, credentials, linked local sources, and native tooling remain available. Installs can execute package scripts. |
| pnpm/Yarn/Bun dependencies (informational) | Use the matching manager/version and the project’s locked-install procedure. | DiskRoom currently detects these layouts only. Guidance here does not enable removal. |
| Python venv | Recreate it with the original interpreter, then install preserved requirements/lock inputs. | Unpinned requirements do not recreate exact versions; editable packages require source; indexes can change. |
| Python bytecode/test cache | Run the application or tests again. | Source and dependencies remain. First use can be slower and previous test metadata is gone. |
| Java class output | Run the documented Maven/Gradle compile or test-compile task. | Source, build configuration, compatible JDK, dependencies, and credentials are available. |
| Unique logs/data | Restore a verified independent backup if one exists. | The audit contains metadata, not the removed contents. No general reconstruction exists. |

Git repacking is available only on Linux. It uses isolated metadata and held filesystem descriptors for object storage; the subprocess does not load the original project config or hooks. It retains unreachable objects, leaves the worktree untouched, and performs no pruning or reflog expiration. Dirty/untracked/ignored classification and remote backup remain unverified. This is not a backup or remote synchronization step. If preservation checks fail after a manager command, the outcome is not silently called successful.

Docker image removal needs a retained registry digest, source build, or image archive for restoration. Container removal permanently removes writable-layer contents; retaining a volume does not preserve data that was written outside that volume. DiskRoom does not capture secret-bearing container configuration as a backup.

DiskRoom does not promise future network availability, recover local dependency modifications from a lockfile, or preserve data merely because it is under a conventional cache path.

## Share reports carefully

Audit files contain absolute paths, host/platform metadata, project names, and operational evidence. They stay local unless you share them. Redact usernames, private project paths, sensitive IDs, and any incidental secrets before posting issues. Never upload private source or credentials to explain a cleanup failure. Follow the repository’s security reporting policy for vulnerabilities.
