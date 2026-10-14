# Isolated example workspace

Create synthetic data without touching existing projects:

```sh
node examples/create-demo.mjs
```

The first stdout line is a freshly created `diskroom-demo-*` directory in the system temporary folder. An optional existing parent directory can be supplied; the script still creates a unique child and never reuses or clears an existing directory.

The script creates less than 1 MB of ordinary data. It does not install dependencies, execute project code, set executable permissions, or delete files. Its Python bytecode and Java class files are deliberately nonexecutable placeholders for metadata-based detection, not runnable programs. Dependency names, registry URLs, and integrity values are fabricated solely to exercise the installed-package membership checks. The registry URL uses the reserved `example.invalid` domain. These projects are not installable: do not run `npm ci` or try to restore their placeholder dependencies. Real projects must retain access to their actual registry packages.

## Inspect and scan

Open the printed directory in a file manager if you want to inspect the fixtures. From outside that demo project (a source scan needs no native compilation):

```sh
node bin/diskroom.js scan <printed-demo-path> --target-free 1MB --json
```

Replace the placeholder with the exact printed path, quoted if it contains spaces. This small goal makes the synthetic log visible without creating a huge file. The goal will normally already be satisfied by your current disk, so **the expected plan is empty**. Detection remains useful even when no cleanup is needed.

| Fixture | What to look for |
| --- | --- |
| `old-node/node_modules` | Consistent synthetic npm manifest, lock, marker, registry metadata, and complete installed-package membership. |
| `old-python/__pycache__` | Bytecode entries with preserved adjacent source. |
| `old-python/.venv` | Recognized environment metadata and preserved restoration inputs. |
| `old-python/.pytest_cache` | Known test-cache entries. |
| `old-java/target/classes` | Java class paths matching preserved Java source. |
| `active-project` | Recent source activity; environment remains protected. |
| `review-data/debug.log` | Review-only synthetic data, never automatically selected. |
| `unrecognized/node_modules` | A folder name without supporting provenance is not enough. |

Old fixture source/manifest timestamps are explicitly set 400 days back for demonstration. Do not backdate real files to bypass activity protection. Process visibility, platform behavior, and the directory from which you run the tool can affect the result; read actual reasons rather than expecting a fixed screenshot.

## Try the review flow

Use the printed scan ID:

```sh
node bin/diskroom.js clean --scan <run-id>
```

This requires an interactive terminal and uses the same audit workspace as your scan. You can inspect candidates and leave without changes. A goal already met should not remove anything.

To test actual deletion automatically, use `npm test`: executor tests measure a temporary fixture’s free-space baseline, set controlled goals, and verify preserved source and boundary files. Do not fill your real disk merely to demonstrate cleanup.

The example script does not clean up after itself. After finishing, verify that the printed directory contains only the synthetic fixture and remove that exact folder manually through your file manager if desired. Keep any `.diskroom` evidence you want to inspect.
