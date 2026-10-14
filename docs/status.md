# Current delivery status

Status recorded on 14 October 2026. This is a prerelease source implementation, not a completed public release or a claim that every specification scenario has passed.

| Deliverable | Current state | Remaining gate |
| --- | --- | --- |
| CLI source | Interactive scan/review/confirmation, planning, audit/history, protections, and bounded cleanup are implemented. | Local integrated review passed; cross-platform release test matrix remains. |
| Repository | Public repository [webgptorg/diskroom](https://github.com/webgptorg/diskroom) contains the source on `main`; owner/permissions are verified. | The exact release commit and packaged artifact must pass the complete [Actions matrix](https://github.com/webgptorg/diskroom/actions). |
| npm | `diskroom` package metadata, bin entry, packaging and publishing workflows are prepared. | Owner-controlled npm identity, verified multiplatform tarball, registry publication, and installed public-package check. |
| Website | Static landing page, documentation, goal illustration, and release-state manifest exist. Production at `https://diskroom.vercel.app` is public; previews remain access-protected. | Owned `diskroom.dev` registration/DNS/HTTPS, and browser verification. |
| License | MIT, approved by the owner; full text is in `LICENSE`. Copyright © 2026 Pavol Hejný. | Include the license and copyright notice in distributed copies. |
| Verification | Recorded local Linux x64 suite: Node 22.23.3 and 24.19.0 each passed 115 tests, with 4 OS-specific skips. Local tarball installation/native smoke and real terminal checks passed. | Cross-platform CI has run and exposed failures; fixes are being validated. The published artifact must pass every source and installed-tarball matrix job. See [live Actions](https://github.com/webgptorg/diskroom/actions) and [recorded evidence](verification.md). |

## Remaining capability limits against the full specification

- The report tree groups candidates by project; it is not a complete arbitrary-depth filesystem browser.
- Complete npm membership can enable dependency-tree cleanup. pnpm/Yarn/Bun dependency layouts, shared npm/pnpm/Yarn/Bun/pip/uv/Maven/Gradle stores, and general build outputs are detection-only.
- Python and JVM execution covers the strict cases in the [capability matrix](capabilities.md); it does not establish arbitrary environment/build-directory reproducibility.
- Runtime installations are detected and identified newest/default/running roles protected; runtime uninstallation and exhaustive dependency resolution are unavailable.
- Git supports conservative reviewed repacking on Linux only, using isolated metadata and descriptor-pinned object storage. macOS/Windows remain detection-only. Dirty/untracked/ignored classification, remote-backup verification, reflog/object pruning, shallow replacement, and whole-project deletion are unavailable.
- Docker supports exact reviewed image/stopped-container operations only when daemon host storage is locally accessible, in scope, and on the target volume. Volumes, build-cache pruning, Desktop virtual-disk cleanup, and remote daemons are unavailable. Docker validation uses a fake CLI and mocked responses; no live daemon execution has been verified in this environment.
- macOS/Windows process observations are partial. They protect observed use but cannot justify automatic recommendations; native platform execution still needs verification.
- Large-inventory limits are explicit and journals are chunked. Million-file performance, genuinely near-full storage, and every filesystem/permission/race scenario have not been established by local fixture tests.
- The static site's local links, headings, labels, and script syntax can be checked without a browser. Responsive rendering and end-to-end public access still need browser verification.

These limits must remain visible in release notes and website metadata. A passing Linux test suite, a local tarball, or a website deployment must not be reported as the requested complete public delivery. See [platform gates](platforms.md) and [release procedure](RELEASING.md).
