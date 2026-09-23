# Cautest Xmake continuation — Kernel/Driver component delivery

This round started **2026-09-23 10:45:28 +08:00** (11:45:28 +09:00).
The hard deadline is **11:45:28 +08:00** (12:45:28 +09:00).
New implementation stopped at **11:33:20 +08:00**, reserving time for final
bundle-clone verification and delivery. No network access was used.
The final seal time and bundle SHA-256 are recorded in the external delivery report.

This is an incremental delivery, **not complete platform acceptance**.
BusyBox 1.36.1 was built and executed as a static binary. Real Linux 6.6.157
configuration was attempted and stopped at `flex: not found`. The real Xmake UML
runner returns **BLOCKED / 77**, not PASS. There was no UML boot, host module load,
Driver device exercise or physical MCU/SPI test in this round.

## Independently verified commits

| Commit | Change |
|---|---|
| `71c6cbe` | One shared UML provision / CTP / collection implementation for old and artifact Jobs |
| `db3024b` | Kernel Runtime Makefile defaults and no-seek compatibility with newer Kernel headers |
| `362182a` | Artifact Kernel Test / Driver ABI Jobs, shared pure Environment factory, static Guest rule and product-owned Kbuild examples |
| `f48fd4c` | Byte-validated Kernel / BusyBox / Agent / Guest / rootfs caches and explicit real-UML prerequisite gate |
| `f4e18f8` | Owned UML process-group cleanup and removal of expired control waiters; portable runtime inclusion |
| `4058d1e` | Real visibility, link propagation, GCC/Clang, output isolation and measured discovery matrix |
| `535bef6` | Relocated portable Kernel/Driver component verification and corrected checkout README |

The application still uses the original integration direction:

```lua
includes("tools/cautest/xmake.lua")
includes("ctest.lua")
```

A named `ctest.environment` factory returns one existing `umlKernelEnvironment`
descriptor. Kernel Test consumes an explicit module Artifact; Driver ABI consumes
separate Driver module refs and a static Guest target ref. Rootfs/UML/CTP/Result
and cleanup reuse the original workflow engine. Shared Environment means shared
declarations and verified build caches, **not a shared VM across Jobs**.

See [Xmake use](../usage/xmake.md), [Kernel/Driver use](../usage/xmake-kernel-driver.md)
and [build-matrix measurements](../tests/xmake-build-matrix.md).

## Verified scope

| Check | Result |
|---|---|
| Default Node suite, rebuilt TypeScript | **149/149**, no failures/skips |
| Real Xmake integration | **16/16**, no failures/skips |
| Real Kbuild components | **2/2**, no failures/skips |
| Explicit real build matrix | **3/3**, no failures/skips |
| Public types, C Runtime, versions and docs | PASS |
| BusyBox 1.36.1 | Static build, shell execution, cache hit and same-size corruption recovery PASS |
| Real Linux 6.6.157 configuration | BLOCKED at missing flex; bison and bc also absent |
| Real Xmake Kernel/Driver UML runner | BLOCKED / 77 after actual list/plan/doctor |
| Physical MCU/SPI | Not run; hardware not provided |

Actual Kbuild checks compile Cautest Runtime, Kernel Test and product Driver
against **preinstalled 6.12.96+deb13-amd64 headers**, not Linux 6.6.157.
They check modules and role/context identity without loading them into the host.
The static Driver Guest is built, but its device read/write/ioctl Cases still need
real UML. Process-cleanup tests use real OS processes with an explicit Agent
emulator; they are not actual UML acceptance.

Portable Native/MCU runs and Kernel/Driver list/plan/static Guest construction
pass from a relocated lib-only directory without `dist` or `node_modules`.
Development dependency files came from the supplied archive; no pnpm was run,
and no empty-Registry-cache `npm ci` success is claimed.

Evidence is retained under `docs/tests/evidence/round3-*`. The default suite,
Kbuild and matrix logs were collected in an independent cold-dist candidate
bundle clone. The final Xmake log includes the extra portable component test.
A fresh clone of the final delivery is checked again; its commands, HEAD and
outcomes are recorded externally in `cautest-bundle-verification.log`.

## Remaining plan items

**G1/G2/G3 pass within their backend/collection/Native scope.** G0 and G4 are
partial; G5 (physical MCU) and G6 (real UML) are blocked; G7 is not passed.

1. XT-003/004/008/015–018: finish simultaneous cross-configuration/toolchain and
   high-Case-count tests, lazy Board transitive-source snapshots, full cache-writer
   concurrency and cross-architecture/startup/linker boundaries.
2. XT-019–021: real MCU ELF/BIN, startup/linker integration, board flash/reset/
   transport failure matrix and physical SPI acceptance. Host simulation does
   not replace these.
3. XT-022–024: artifact workflows and components now exist. Supply Linux build
   tools and execute actual Linux 6.6.157 Kernel Test + Driver ABI, cold/cache-hot,
   read/write/ioctl, bad input and real boot/module/Guest failure/cleanup cases.
   `flex`, `bison` and `bc` are absent. libelf development headers are also absent,
   but the build has not reached evidence that they are required for this UML
   configuration. BusyBox source is no longer a blocker.
4. XT-025–027: cold dependency deployment, supported native-addon deployment and
   full platform CI/release candidate acceptance. No push/tag/publish was done.

The original uploaded plan under `xmake-test-v0.1.0/` remains unchanged.
Task-by-task status is in [xmake-test-progress.json](xmake-test-progress.json).
XT-028–030 remain deferred as the original plan specifies.
