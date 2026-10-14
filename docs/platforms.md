# Platform verification

DiskRoom targets native Linux, macOS, and Windows, with Node.js 22 and 24 in the test matrix. Windows does not require WSL. Target support is not the same as a completed native test run.

The release process must update the table from actual CI and installed-package results before claiming a verified release. Defining a workflow, compiling on another OS, or running Linux tests is not proof of Windows/macOS behavior.

| Target | Native source tests | Installed package tests | Current status |
| --- | --- | --- | --- |
| Linux x64 | Node 22.23.3 and 24.19.0: 115 passed, 4 OS skips each | Local tarball installed without scripts; Node 24 native/CLI smoke passed | Verified locally; complete release matrix pending. |
| Linux arm64 | Pending | Pending | CI target configured. |
| macOS Intel | Pending | Pending | CI target configured. |
| macOS Apple silicon | Pending | Pending | CI target configured. |
| Windows x64 / PowerShell | Pending | Pending | CI target configured. |

Local Linux x64 results were recorded on 14 October 2026. Cross-platform CI has run and exposed failures; fixes require another complete run. See [live Actions](https://github.com/webgptorg/diskroom/actions) for current results and [verification evidence](verification.md) for recorded scope and limitations. Every advertised target and installed-tarball job must pass for the exact published artifact.

See `.github/workflows/ci.yml` for the current exact runner/Node matrix and `web/release.json` for public release status. Optional managers and Docker/Git actions do not gain execution support merely because Node tests pass; refer to [capabilities](capabilities.md).

## Platform differences

| Area | Linux | macOS | Windows |
| --- | --- | --- | --- |
| Process observation | Observable same-user `/proc` cwd/exe/fd/absolute argv; not complete across permission boundaries. | System `lsof`: same-user cwd, text/executable mappings, and open files; always partial. | Native-resolved PowerShell/CIM: same-user executable and absolute arguments; no cwd/open handles; always partial. |
| Automatic recommendation | Requires all ordinary evidence/protections and sufficient observable process coverage. | Partial process visibility prevents automatic recommendation. | Partial process visibility prevents automatic recommendation. |
| Cleanup filesystem support | Implemented bounded non-following path handling and checks. | Requires the supported native bridge; unavailable bridge refuses cleanup. | Requires the supported native bridge; unavailable bridge refuses cleanup. |
| Audit directory | `.diskroom` hidden by dot convention. | `.diskroom` hidden by dot convention. | Native handle API sets the hidden attribute when available. Without the bridge, scans report a warning and the directory can remain visible. |
| Git maintenance | Descriptor-pinned conservative repacking after explicit review. | Detection only; no pinned subprocess storage view. | Detection only; no pinned subprocess storage view. |
| Allocation estimates | Uses available filesystem allocation metadata; shared links remain uncertain. | Same principle, subject to native/filesystem details. | Unknown allocation is not represented as guaranteed zero. |
| Path semantics | Native POSIX paths and volume boundaries. | Native paths and aliases; chosen audit workspace is canonicalized. | Native drives, case behavior, reparse/junction safeguards, and quoted paths. |

## Verification expected before release

The CI matrix must run syntax checks, isolated scanner/planner/executor tests, native helper smoke tests, and an installed-tarball smoke on each advertised target/Node pair. The assembled tarball must contain the verified native prebuilds and license, be checksum-verified, and be installed without lifecycle scripts in the smoke job.

Interactive behavior additionally needs terminal verification: arrow/Tab navigation, resize/width handling, no-color output, final confirmation, and Ctrl+C. Synthetic destructive tests must stay inside their own disposable temporary fixtures.

Do not claim universal open-file discovery, full runtime-dependency analysis, every package-manager version, every filesystem type, or hostile concurrent-user safety. Record any actual test evidence and its limits in the release notes.
