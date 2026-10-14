# Local verification evidence

Recorded 14 October 2026. These are local prerelease checks, not evidence of an npm publication or a completed cross-platform release.

| Check | Actual result |
| --- | --- |
| Linux x64, Node 24.19.0 source suite | 119 tests: 115 passed, 0 failed, 4 OS-specific skips. |
| Linux x64, Node 22.23.3 source suite | 119 tests: 115 passed, 0 failed, 4 OS-specific skips. |
| Source syntax / identity | `npm run check` passed. |
| Native bridge | Linux x64 compiled from source and exercised by the source suite and installed-package smoke. |
| Local npm packaging | Whitelisted files checked; tarball installed in a fresh temporary directory with lifecycle scripts disabled; installed command reports 0.1.0. This tarball contains only a local Linux x64 native build and is not the multiplatform release artifact. |
| Installed native smoke | Create/read/remove confined temporary entries, reject traversal, refuse link traversal, preserve unrelated source: passed. |
| Real terminal | Installed CLI wizard: arrow/Tab navigation, scope details, Escape, scan-only report, Unicode search, resize to 45 columns, Ctrl+C exit 130 and terminal mode restoration passed. Real raw-mode final-confirmation UI defaults to NO. |
| Actual filesystem cleanup | Isolated fixture tests cover bounded deletion, source preservation, changed identities, active processes, audit failure and stop-after-target behavior. No user data was used for destructive testing. |
| Git | Actual Linux maintenance and full executor/audit integration passed; object/ref/source preservation and replaced pack-directory confinement tested. |
| Docker | Exact-command, scope, daemon drift and resource checks used controlled fake CLI responses. No live Docker daemon was available. |
| Static web | Three HTML pages checked for local links/fragments, IDs, headings and basic labels; calculator branches checked with fixed demonstration inputs. |

The source suite is run with `node --test`. The local installed-package smoke is `node native/smoke.mjs /absolute/path/to/installed/diskroom/native/index.js`.

## Remote CI evidence

Sources are present on `main` in [webgptorg/diskroom](https://github.com/webgptorg/diskroom). CI runs [38614542668](https://github.com/webgptorg/diskroom/actions/runs/38614542668) and [38615387227](https://github.com/webgptorg/diskroom/actions/runs/38615387227) failed; they are not release approval. Target-specific fixes are being validated. Consult [live Actions](https://github.com/webgptorg/diskroom/actions) for newer results.

The release gate is one complete successful source, package-assembly, and installed-tarball matrix for the exact artifact and commit being published. Local results and passing jobs from different commits cannot substitute for that gate.

## Outstanding evidence

- A complete successful CI matrix on every declared target, including Linux arm64, macOS Intel/Apple silicon, Windows x64, and the assembled single multiplatform tarball.
- Real Docker daemon removal on disposable resources; Git maintenance on macOS/Windows is deliberately unavailable.
- Browser rendering on desktop/mobile. Playwright was installed, but browser executables were unavailable; the connected browser timed out. No screenshot or visual QA claim is made.
- Custom-domain registration/DNS/TLS and public npm installation.
- Production website access is enabled publicly on `diskroom.vercel.app`; preview deployment protection remains enabled. Browser visual verification is still pending.
- Million-file performance, genuinely near-full storage and every filesystem/permission/concurrency scenario.

See [delivery status](status.md), [platform gates](platforms.md), and [capability limits](capabilities.md).
