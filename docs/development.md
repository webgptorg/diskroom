# Development

DiskRoom uses native ESM JavaScript and Node.js built-ins. There are no runtime npm dependencies. Node.js 22.23.3+ is required. Run all destructive tests only over isolated fixtures.

## Work on the CLI

From the provided source checkout, use Node.js 22.23.3+ and its bundled npm. There is no dependency installation step for the JavaScript application. Help and scans run directly:

```sh
node bin/diskroom.js --help
npm run check
node examples/create-demo.mjs
```

Build the native bridge before the full native test run:

```sh
npm run build:native
node --test
node native/smoke.mjs
```

To require native availability instead of allowing platform tests to skip, run `DISKROOM_REQUIRE_NATIVE=1 npm test` on a POSIX shell. In PowerShell use `$env:DISKROOM_REQUIRE_NATIVE='1'`, then `npm test`, then `Remove-Item Env:DISKROOM_REQUIRE_NATIVE`. Test fixtures are temporary and isolated; do not substitute real user directories.

This does not install or publish a global command. `node bin/diskroom.js` is the source entry point.

The scanner, planner, executor, audit layer, and terminal interface are separated under `src/`. Built-in detector modules live under `src/plugins/`. `CONTRACTS.md` documents the internal interfaces. This is not a stable public SDK.

The package includes a small native filesystem bridge for platform operations that Node’s path-only API cannot safely implement. CI builds verified precompiled binaries for declared targets. Developers building that bridge need appropriate platform C/C++ build tools and Node headers:

```sh
npm run build:native
```

The default development build uses a pinned node-gyp version and may download build tooling/Node headers. On supported Unix systems, an explicit `DISKROOM_NODE_HEADERS` directory containing `node_api.h` allows the script to use a local compiler/header installation. Read the build script before supplying a custom toolchain. For example, when official Node development headers are already installed at `/usr/include/node` on Linux:

```sh
DISKROOM_NODE_HEADERS=/usr/include/node npm run build:native
```

Use the actual header directory for your system, not this path blindly. Windows development requires Python and Visual Studio C++ build tools; macOS requires Xcode command-line tools; Linux requires a C compiler. The finished package must include the verified prebuilds and must not rely on end-user compilation. A local single-platform build is insufficient for publication. See [native bridge](../native/README.md) and [platform verification](platforms.md).

## Use the synthetic workspace

```sh
node examples/create-demo.mjs
node bin/diskroom.js scan <printed-demo-path> --json
```

The fixture is synthetic and small. There is no reason to scan or clean your actual home directory to verify a code change. The fixture’s ordinary timestamps and expected recommendations may differ by platform/process visibility; use actual reported evidence instead of assuming a screenshot’s selection.

## Website

`web/` is plain static HTML, CSS, JavaScript, and a vector favicon. There is no build command, framework, CDN font, analytics, or remote runtime dependency.

For a local preview from the repository root, serve `web/` with any static HTTP server, for example:

```sh
python3 -m http.server 8080 --directory web
```

Open `http://localhost:8080/`. The interactive goal calculator uses labeled synthetic data and never requests filesystem access.

### Release manifest

Update `web/release.json` only from verified evidence:

```json
{
  "version": "0.1.0",
  "npmPublished": false,
  "npmUrl": null,
  "repositoryUrl": null,
  "siteUrl": null,
  "license": "MIT",
  "platformVerification": {
    "linux": "Verification in progress",
    "macos": "Native verification pending",
    "windows": "Native verification pending"
  }
}
```

Publication links stay hidden until verified HTTPS npm/GitHub destinations are supplied. Pending state remains honest without JavaScript or if the manifest is unavailable. Do not set `npmPublished` merely because a tarball exists or a publish workflow is configured.

Deployment may use any static host. Serve the canonical owned domain over HTTPS; optional `www` redirects should preserve the path. Do not configure an unowned domain. The site does not depend on the CLI and the CLI does not depend on the site.

## Release gates

The owner approved the MIT License. Account and ownership decisions still require the relevant owner authorization. Verify package identity, native CI on every advertised platform, tarball contents and checksums, installed command behavior, documentation consistency, publication permissions, and real web/domain status. Source-only commits, a CI workflow definition, or a local tarball are not an npm release. See [current status](status.md) for remaining delivery and specification work.
