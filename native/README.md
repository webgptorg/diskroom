# Native filesystem safety bridge

DiskRoom's native bridge exposes synchronous, descriptor-anchored operations on a
single filesystem entry. It never recursively removes a path, invokes a shell,
follows symlinks, or changes permissions. The JavaScript executor remains
responsible for confirmation, durable per-entry intent/result auditing, inventory,
activity checks and limits.

## API

`native/index.js` exports `available` (boolean), `unavailableReason`, and:

- `openRoot(absolutePath)` — open every ancestor separately without following
  links. Windows requires a local drive path; UNC and network drives fail closed.
- `openDirectory(parent, name)` — open one real child directory, refusing a
  different device. Ancestors remain alive until all children close.
- `stat(handle)` and `statChild(parent, name)` — `dev`, `ino`, `mode`, `size`,
  `nlink`, `mtimeMs`, `ctimeMs`, `type` (`file`, `directory`, `symlink`, `other`).
  Extra `identity`, `mtimeNs`, `ctimeNs` strings retain full native precision.
  The `*Ns` strings contain `seconds:nanoseconds` and are opaque compare tokens.
- `readDirectory(handle)` — entry names; limit 250,000 entries per directory.
  Exceeding the limit fails before returning an inventory.
- `removeChild(parent, name, expectedStat, {directoryIdentityOnly: false})` —
  compare and delete one regular file, link itself, or empty directory. Links are
  never traversed; unknown Windows reparse tags and other filesystem node types
  are refused. After the executor deletes a
  directory's inventoried children, `directoryIdentityOnly: true` compares its
  device/inode/type because its own timestamps have necessarily changed.
- `close(handle)` — idempotent; further operations on that wrapper fail.
- `systemDirectory()` — Windows only: the OS-provided `GetSystemDirectoryW`
  directory, independent of the caller's `PATH` or `SystemRoot` environment.
  Used to locate trusted system PowerShell for bounded process observation.
- `markHidden(absolutePath)` — Windows only: open an ordinary directory through
  `openRoot`, reopen its pinned handle for attributes, and preserve existing
  attributes while adding `FILE_ATTRIBUTE_HIDDEN`. Links/junctions are refused.
  This is for the `.diskroom` audit directory; it does not change ACLs.
  Both Windows-only methods throw `ERR_UNSUPPORTED_PLATFORM` on other systems.

Use native stats from the inventory for later native deletion comparisons.
All child names must be a single component. Never pass a path to child methods.
Only `openRoot` and `markHidden` accept an absolute path. Close child handles before deleting
their directories, particularly on Windows. Handles also close at GC, but the
executor must explicitly close them in `finally` blocks.

## Platform boundary

POSIX uses `openat(O_DIRECTORY | O_NOFOLLOW)`, `fstatat(AT_SYMLINK_NOFOLLOW)` and
`unlinkat` relative to an open directory descriptor. A renamed ancestor cannot
redirect operations into a symlink target. POSIX does **not** offer an atomic
"unlink this name only if its inode still equals X" syscall: a malicious process
can swap the final leaf between the comparison and `unlinkat`. The operation
still cannot follow that swapped link or recursively delete a replacement tree,
but it can unlink the replacement leaf. Therefore DiskRoom does not promise
transactional isolation against an adversary concurrently modifying the same
cleanup tree. Renaming an already-open directory elsewhere also preserves the
descriptor's identity rather than following its new pathname. Ordinary activity
is revalidated by the executor, and detected changes fail closed.

Windows opens the drive root with `CreateFileW(FILE_FLAG_OPEN_REPARSE_POINT)` and
opens every descendant as a single name relative to the parent directory HANDLE
using the documented `NtCreateFile` `RootDirectory` field and
`FILE_OPEN_REPARSE_POINT`. No descendant operation resolves an absolute pathname.
Every ancestor is retained and denies write/delete sharing; incompatible renames
or writes fail while held.
Deletion opens the leaf with `DELETE | FILE_READ_ATTRIBUTES`, permits only known
symlink/junction reparse tags, compares the opened object, then uses
`SetFileInformationByHandle(FileDispositionInfo)` on that same handle. Files held
open with incompatible sharing permissions fail closed. A successful delete can
remain pending while another compatible reader holds the file; actual recovered
space is determined by a fresh filesystem measurement, not the delete return.

Local Linux testing does not validate macOS/Windows behavior. Release gates must
build and exercise the installed npm tarball on every advertised OS/architecture.
The intended matrix is Linux x64/arm64, macOS x64/arm64 and Windows x64, testing
the product minimum Node 22.23.3 and the current Node 24 release.
Unsupported or missing native binaries disable deletion; there is no path-based
unsafe fallback in this bridge.

## Build and package

`node scripts/build-native.mjs` runs pinned `node-gyp@13.1.0` using the current
Node headers and the platform compiler (GCC/Clang, Xcode tools or MSVC). It writes
`native/prebuilds/<platform>-<arch>/diskroom_native.node`. N-API v8 keeps the
binary ABI stable across supported Node releases. Windows requires a current
Visual Studio C++ build-tools installation, supplied by GitHub's runner image.
This pin supports Visual Studio 2026 (18.x), including its corrected version
detection. The build tool itself requires Node 22.22.2+ in the Node 22 line or
Node 24.15.0+ in the Node 24 line; CI installs current patches in both lines.
These are build-tool prerequisites, not a change to the published N-API runtime
support. See the [node-gyp release notes](https://github.com/nodejs/node-gyp/releases/tag/v13.1.0)
and [engine requirement](https://github.com/nodejs/node-gyp/blob/v13.1.0/package.json).

For offline Unix builds, `DISKROOM_NODE_HEADERS=/path/to/official/node/headers`
uses `CC` (default `cc`) directly. No header downloads or compilation occur when
users install the published package. CI assembles the five native binaries into
one tarball. Do not commit build outputs or publish a locally incomplete tarball.

`node native/smoke.mjs /absolute/path/to/installed/diskroom/native/index.js` runs
isolated-fixture checks against that exact installed package, including removal
of a link while preserving its target. Set
`DISKROOM_REQUIRE_NATIVE=1` for the test suite to fail instead of skip when the
local platform binary is missing.

API references: [POSIX openat](https://pubs.opengroup.org/onlinepubs/9799919799/functions/open.html),
[POSIX unlinkat](https://pubs.opengroup.org/onlinepubs/9799919799/functions/unlink.html),
[CreateFileW](https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-createfilew),
[NtCreateFile](https://learn.microsoft.com/windows/win32/api/winternl/nf-winternl-ntcreatefile),
[GetSystemDirectoryW](https://learn.microsoft.com/windows/win32/api/sysinfoapi/nf-sysinfoapi-getsystemdirectoryw),
[ReOpenFile](https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-reopenfile),
[SetFileInformationByHandle](https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle).
