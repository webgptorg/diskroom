# Security policy

DiskRoom is a local disk-cleaning tool. A mistake can destroy data. Its safety boundary is documented in [docs/safety.md](docs/safety.md), its executable operations in [docs/capabilities.md](docs/capabilities.md), and its release state in [docs/status.md](docs/status.md).

## Supported versions

Use the latest published `0.1.x` version for fixes within this initial release line. Check the npm registry for publication and [platform verification](docs/platforms.md) for the recorded native test evidence. Source versions and CI artifacts do not by themselves establish registry publication; no support commitment is made for unreleased versions or untested platforms.

## Report a vulnerability privately

In [the source repository](https://github.com/webgptorg/diskroom), use **Security → Report a vulnerability** when private reporting is enabled. If that option is absent, contact the project owner through an established private channel to request a secure reporting route. Do not put an exploitable data-loss issue or sensitive audit into a public issue merely because the private-reporting option is absent.

Include the installed/source version, operating system and architecture, a description of the expected boundary and observed result, and minimal reproduction steps using a newly created disposable fixture. Redacted paths and relevant error/status codes are useful. Do not send credentials, private source code, live customer data, complete raw command lines, or an unredacted audit.

For a suspected cleanup failure, stop further cleanup, preserve the existing audit, and inspect it before acting on a stale lock or interrupted run. An audit records metadata; it does not back up deleted content or make restoration possible by itself.

## Limits

DiskRoom does not provide a security sandbox against a hostile local user concurrently modifying the same writable tree. Process observation is incomplete, installation metadata cannot prove future registry availability, and files modified inside installed packages may be unique. A protected or unsupported resource must fail closed rather than be forced through an operation.

All destructive investigation and regression tests must remain inside isolated temporary fixtures or explicitly created test-manager resources. Never test a suspected deletion vulnerability on real user projects or a production Docker daemon.
