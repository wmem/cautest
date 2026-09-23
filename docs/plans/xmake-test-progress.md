# Cautest Xmake continuation — verified incremental delivery

Start: **2026-09-23 10:12:13 +09:00**. Hard deadline: **11:12:13 +09:00**.
New feature work stopped at **11:03:26 +09:00** (51m13s) to reserve delivery verification.
The uploaded Xmake 3.1.1 executable removed the previous blocker. No network access used.

## Implemented and independently committed

| Commit | Change | Evidence |
|---|---|---|
| eda42de | Real Xmake table DSL / Node nested-build PoC | xmake-poc-20260923.tap |
| 76a683c | POSIX cancellation terminates compiler descendants | process-tree-20260923.tap |
| cacef6d | Strict artifacts and shared Native/MCU runtime steps | artifact-runtime-20260923.tap |
| 5b436a9 | Vendored root xmake.lua, ctest.*, real Native loop | xmake-adapter-20260923.tap |
| b62364e | First-build generation fences and same-second compile/link invalidation | xmake-native-reliability-20260923.tap |
| 1201fc1 | Real MCU host firmware simulation and physical locks | xmake-mcu-full-20260923.tap |
| 26b4c68 | Relocated portable Native/MCU + real Kbuild multi-output product example | xmake-delivery-kbuild-20260923.tap |
| cb9bd54 | Late factory cancellation: no flash, exactly-once owned close | xmake-late-cleanup-20260923.tap |

Evidence files are under `docs/tests/evidence/`. Final source tests:
**133/133 default Node; 14/14 real Xmake; 1/1 real Kbuild; zero failures/skips.**
TypeScript, public declarations, C Runtime, versions and Markdown checks pass.
Actual Kbuild evidence uses **preinstalled 6.12.96+deb13-amd64 headers**, NOT
Linux 6.6.157 and NOT UML. No module is loaded into the host kernel.
Portable Native and MCU simulation run without dist or node_modules, with manifest
integrity retained. Registry-cold npm ci was not run; supplied local dependencies
were used to prepare source checkouts.

## Application entry

```lua
includes("tools/cautest/xmake.lua")
includes("ctest.lua")
```

```lua
ctest.project {defaults = {resultDir = ".cautest/results"}}
ctest.include {patterns = {"modules/**/test.lua"}}
```

```sh
npm --prefix tools/cautest ci
xmake ct --list --json
xmake ct --plan --level=unit
xmake ct --level=unit,component --tag=host,math
xmake ct --test-profile=ci --reporter=json,junit
```

Create explicit application-owned test targets as shown in
[the Xmake guide](../usage/xmake.md). Runtime case filters do not generate Registry
symbols. Ordinary product builds do not require Node. There is no auto-install,
no implicit product-target cloning and no project-wide implicit test scan.

## Remaining work and honest gates

G2 (collection) and G3 (real Native example) pass. G0/G1/G4 have extensive scoped
Native evidence but the full planned matrix is not complete. G5 requires physical
SPI and is blocked; G6 needs the not-yet-implemented artifact-backed Kernel/Driver
runtimes plus real UML evidence. G7 full release remains not passed.

1. Finish XT-003/004/008/015–018 broad visibility/toolchain/concurrency/scale
   coverage and the Environment factory; complete provider dependency tracking.
2. Finish XT-019–021 for real MCU ELF/BIN, startup/linker integration and the
   physical flash/reset/serial/SPI error/recovery matrix. No board was supplied.
3. Complete XT-022–024: split the legacy Kernel/Driver runtime to consume explicit
   module/Guest/Kernel roles from one Environment, then boot actual Linux 6.6.157
   with BusyBox and test Driver read/write/ioctl. flex/bison/bc/libelf development
   inputs and BusyBox source are unavailable here. The 6.12.96 Kbuild check does
   not replace these gates.
4. Complete XT-025–027 cold dependency deployment and all-platform release/CI.
   Keep XT-028–030 deferred exactly as the original plan specifies.

The original uploaded plan in `xmake-test-v0.1.0/` is preserved without changing
its historical acceptance claims. Current per-task status and boundaries are in
[xmake-test-progress.json](xmake-test-progress.json). Fresh bundle verification
and final delivery hash/time are reported in the external delivery files.
