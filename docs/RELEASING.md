# Releasing DiskRoom

The release unit is the **single `diskroom-package` artifact from a successful CI run**. It contains the npm tarball, its file inventory (`pack.json`), and a manifest with version, source commit and SHA-512 integrity. A tarball made on one developer's machine does not contain all platform binaries and must not be used for a public release.

## Quality gates

CI compiles and tests the native filesystem bridge on the following runners, with the exact minimum runtime Node 22.23.3 and the current Node 24 release for every target:

| Target | GitHub-hosted runner |
| --- | --- |
| Linux x64 | `ubuntu-24.04` |
| Linux arm64 | `ubuntu-24.04-arm` |
| macOS Intel | `macos-15-intel` |
| macOS Apple Silicon | `macos-15` |
| Windows x64 | `windows-2025` |

After all ten source-test jobs pass, CI assembles the Node 22.23.3 N-API prebuilds into one tarball. Ten additional jobs install that same tarball without installation scripts, check CLI startup and exercise its native bridge against temporary fixtures. No job runs cleanup against user folders. Windows arm64 and Linux distributions with a different C library are not validated release targets. Passing Linux CI does not establish Windows or macOS support.

The workflow has no publish permission. Read `.github/workflows/ci.yml` for the exact gates; every job must succeed before a release is eligible. The GitHub runner labels are documented in the [runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

## First publication

1. Confirm the repository owner. The owner approved the MIT License; verify that package metadata says `MIT` and the full `LICENSE` text with copyright © 2026 Pavol Hejný is included. Ensure `repository.url` is exactly `git+https://github.com/webgptorg/diskroom.git`.
2. Push the reviewed sources to the public `webgptorg/diskroom` repository and wait for every CI job to pass. Review the packaged inventory, target matrix and manifest for that exact commit.
3. Download and extract that run's `diskroom-package` artifact. Verify its tarball SHA-512 against `manifest.json` before using it. Confirm that the intended npm account owns or can claim `diskroom`.
4. Run `npm login --auth-type=web --registry=https://registry.npmjs.org` in the maintainer's terminal. Complete npm's browser authentication and 2FA flow, then check the account with `npm whoami --registry=https://registry.npmjs.org`. Never put passwords, recovery codes, OTPs or access tokens in repository files, issue comments or chat.
5. From the extracted artifact folder, publish the reviewed tarball (replace the version with the manifest's version):

   ```sh
   npm publish ./diskroom-0.1.0.tgz --ignore-scripts --access public --registry=https://registry.npmjs.org
   npm view diskroom@0.1.0 version dist.integrity repository.url --json --registry=https://registry.npmjs.org
   ```

   The registry integrity must match the manifest. This bootstrap uses the maintainer's npm session; it does not claim GitHub OIDC provenance.

npm also supports staging a package before owner approval. Staging a new name creates a public placeholder, while the staged code remains unpublished until an owner approves with 2FA. See [publishing an unscoped package](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/) and [npm login](https://docs.npmjs.com/cli/v11/commands/npm-login/). Do not publish a placeholder as if it were the working application.

## Configure subsequent releases

In GitHub repository settings, create an environment named `npm`. Restrict it to `main` and add the owner as a required reviewer. Configure rules protecting `main`, the release workflow and version tags as appropriate for the repository's collaborators. This environment is an actual GitHub setting: merely mentioning it in YAML does not configure reviewers.

In the npm package settings, add this trusted publisher:

| Setting | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `webgptorg` |
| Repository | `diskroom` |
| Workflow filename | `publish.yml` |
| Environment | `npm` |
| Allowed action | Direct publishing with `npm publish` |

The workflow uses hosted runners, Node 24, npm 11.5.1 or newer, and job-scoped `id-token: write`. It uses no npm write secret and no package-manager cache. Complete the first publish within two days of configuring the publisher, or recreate the expired configuration. New publisher configurations permit staging by default; direct publishing must be enabled for this workflow. These requirements are documented in [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

## Publish a new version

1. Update the version and release notes; commit the complete reviewed change to `main`.
2. Create the matching version tag on that exact commit, for example `v0.1.1`, and push the tag. Do not move an existing published tag.
3. Open **Actions → Publish npm package → Run workflow**. Select `main`, enter the exact package version, choose `latest` (or `next` for a prerelease), and enable the public release confirmation.
4. The workflow validates the version, license, repository and tag, then reruns the entire cross-platform pipeline. Review and approve the `npm` environment when the successful artifact is ready.
5. The publisher verifies the artifact integrity, publishes that same tarball, and compares the npm registry integrity. A pull request, push, or tag alone never publishes.

OIDC releases from this public repository receive npm provenance automatically. Provenance links the published bytes to their build; it is not a guarantee that the code is safe. See [npm provenance](https://docs.npmjs.com/generating-provenance-statements/).

After success, verify a fresh install with `npx diskroom@VERSION --version` and `npx diskroom@VERSION --help`, then update `web/release.json` with verified repository/package links and the released version. Deploy the website and check the links. Only advertise the release after these checks pass.

## Recovery

If validation, native compilation, any platform test, the package smoke test or npm authentication fails, fix the cause and rerun the gates. Do not skip a platform job or substitute a locally assembled tarball. A published name/version cannot be reused; fix a faulty release in a new version. A failed registry verification after npm reports a successful publish requires checking the registry before retrying, because the version may already exist. npm's exact publishing behavior is described in [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/).
