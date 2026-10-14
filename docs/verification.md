# Verification evidence

Recorded 14 October 2026. Local checks and remote CI are listed separately. Neither is proof of registry publication or canonical-domain availability. Results apply to the recorded source and artifact, not automatically to later changes.

## Historical local checks

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

## Successful remote CI

[CI run 38619566523](https://github.com/webgptorg/diskroom/actions/runs/38619566523) completed successfully on 14 October 2026 for commit `4c044e66e965200aaef5f2e02bec3fbf5d342cc9`.

| Check | Recorded result |
| --- | --- |
| Native source matrix | All ten jobs passed: Node 22.23.3 and Node 24 across Linux x64/arm64, macOS x64/arm64, and Windows x64. |
| Windows source test log | 106 tests passed, 13 platform-specific skips, no failures. |
| Artifact assembly | One `diskroom-package` artifact assembled after all source jobs passed. |
| Installed-package matrix | All ten jobs installed that same tarball without lifecycle scripts and passed CLI/bin-shim/native smoke checks. |
| Total | 21 successful jobs: ten source, one assembly, ten installed-package. |
| Downloaded artifact | GitHub artifact ID `11921626132`; archive SHA-256 `668c595f20346c50a5f07e6113db744804c9bdd59952be8bebec53dcdd09ed8d`. |
| Tarball inventory | 44 packaged files, including five target-native binaries; MIT license and Node `>=22.23.3` metadata verified. |

The archive SHA-256 identifies the downloaded GitHub ZIP. The tarball has its own SHA-512 integrity in `manifest.json`; that tarball integrity must match the registry after publication. A successful artifact build does not claim the version is already published.

Earlier runs [38614542668](https://github.com/webgptorg/diskroom/actions/runs/38614542668), [38615387227](https://github.com/webgptorg/diskroom/actions/runs/38615387227), and [38617605431](https://github.com/webgptorg/diskroom/actions/runs/38617605431) failed and remain historical records. The successful run above verifies its own commit. Consult [live Actions](https://github.com/webgptorg/diskroom/actions) for newer results.

Every release still requires one complete successful source, package-assembly, and installed-tarball matrix for its exact artifact and commit. Local results and passing jobs from different commits cannot substitute for that gate.

## Outstanding evidence

- Real Docker daemon removal on disposable resources; Git maintenance on macOS/Windows is deliberately unavailable.
- Browser rendering on desktop/mobile. Playwright was installed, but browser executables were unavailable; the connected browser timed out. No screenshot or visual QA claim is made.
- Registry publication and fresh public-package installation are separate release checks: compare the selected version’s registry integrity to its tested manifest. Custom-domain registration/DNS/TLS is separate from the working Vercel production URL.
- Production website access is enabled publicly on `diskroom.vercel.app`; preview deployment protection remains enabled. Browser visual verification is still pending.
- Million-file performance, genuinely near-full storage and every filesystem/permission/concurrency scenario.

See [delivery status](status.md), [platform gates](platforms.md), and [capability limits](capabilities.md).
