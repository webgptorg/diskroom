# Delivery and release status

Use the repository and CI records to verify source code, the npm registry to verify a published version, and the live site to verify website availability. Test results apply to their recorded commit and artifact.

| Deliverable | Implementation and recorded evidence | How to verify a release |
| --- | --- | --- |
| CLI source | Interactive scan/review/confirmation, planning, audit/history, protections, and bounded cleanup are implemented. | Read the [capability matrix](capabilities.md) and the chosen version’s test evidence. |
| Repository | Public [webgptorg/diskroom](https://github.com/webgptorg/diskroom) contains the source and release workflows. | Match the published version to its reviewed source commit and complete [Actions matrix](https://github.com/webgptorg/diskroom/actions). |
| npm | Package identity is `diskroom`; a release contains one tarball with all five native prebuilds, MIT license, and a CLI entry point. | Query the public registry and compare its version/integrity with the tested artifact. A CI artifact alone is not a published npm package. See [release procedure](RELEASING.md). |
| Website | Public production is [diskroom.vercel.app](https://diskroom.vercel.app); previews are access-protected. `diskroom.dev` is the intended canonical domain. | Verify current public HTTPS access, release-manifest links, and domain registration/DNS/TLS separately. The canonical domain and browser rendering were not verified in the evidence recorded on 14 October 2026. |
| License | MIT, approved by the owner; full text is in `LICENSE`. Copyright © 2026 Pavol Hejný. | Include the license and copyright notice in distributed copies. |
| Verification | [Run 38619566523](https://github.com/webgptorg/diskroom/actions/runs/38619566523), commit `4c044e66`, passed all 21 jobs: ten source jobs, one artifact assembly, and ten installed-package jobs on 14 October 2026. | Later commits need their own complete matrix for the exact artifact being published. See [platform evidence](platforms.md) and [verification record](verification.md). |

For a version you intend to install, the registry query is:

```sh
npm view diskroom@VERSION version dist.integrity repository.url --json --registry=https://registry.npmjs.org
```

Replace `VERSION` with the intended version. A successful matching result establishes registry publication; source metadata, an installation example, or a website label does not.

## Remaining capability limits against the full specification

- The report tree groups candidates by project; it is not a complete arbitrary-depth filesystem browser.
- Complete npm membership can enable dependency-tree cleanup. pnpm/Yarn/Bun dependency layouts, shared npm/pnpm/Yarn/Bun/pip/uv/Maven/Gradle stores, and general build outputs are detection-only.
- Python and JVM execution covers the strict cases in the [capability matrix](capabilities.md); it does not establish arbitrary environment/build-directory reproducibility.
- Runtime installations are detected and identified newest/default/running roles protected; runtime uninstallation and exhaustive dependency resolution are unavailable.
- Git supports conservative reviewed repacking on Linux only, using isolated metadata and descriptor-pinned object storage. macOS/Windows remain detection-only. Dirty/untracked/ignored classification, remote-backup verification, reflog/object pruning, shallow replacement, and whole-project deletion are unavailable.
- Docker supports exact reviewed image/stopped-container operations only when daemon host storage is locally accessible, in scope, and on the target volume. Volumes, build-cache pruning, Desktop virtual-disk cleanup, and remote daemons are unavailable. Docker validation uses a fake CLI and mocked responses; no live daemon execution has been verified in this environment.
- macOS/Windows process observations are partial. They protect observed use but cannot justify automatic recommendations. Passing native tests does not make these observations complete.
- Large-inventory limits are explicit and journals are chunked. Million-file performance, genuinely near-full storage, and every filesystem/permission/race scenario have not been established by local fixture tests.
- The static site's local links, headings, labels, and script syntax can be checked without a browser. Responsive rendering and browser interactions remain unverified; public HTTP availability alone does not validate them.

These limits must remain visible in release notes and website metadata. A passing CI matrix, a tarball, or a website deployment alone does not establish npm publication, canonical-domain availability, or every scenario in the specification. See [platform gates](platforms.md) and [release procedure](RELEASING.md).
