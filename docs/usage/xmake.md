# Xmake adapter (Linux x86_64, Xmake 3.1.1)

Clone this repository into the application's `tools/cautest`, then run `npm ci`
in that directory. npm's prepare builds the Node runtime; Xmake does not install
anything. With dependencies already installed, use `npm run prepare`. Runtime
execution after preparing needs Node >=20.6, not node_modules.

```lua
-- application's xmake.lua; Cautest does not set project/version/toolchains
includes("tools/cautest/xmake.lua")
includes("ctest.lua")
```

```lua
-- application's ctest.lua: explicit root, deterministic sorted fragments
ctest.project {defaults = {resultDir = ".cautest/results"}}
ctest.include {patterns = {"modules/**/test.lua"}}
```

```lua
-- modules/math/test.lua
-- Relative paths are anchored to this declaring file, not the shell's cwd.
target("test.math")
    set_kind("binary")
    set_default(false)
    add_rules("cautest.native")
    add_files("math_test.c")
    add_values("cautest.registry.suites", "math_test")
target_end()
ctest.native {
    id = "unit.math", target = "test.math", level = "unit",
    tags = {"host", "math"}, run = {suite = "math_*"}
}
```

`cautest.registry.suites` contains **explicit C Suite symbols**, never patterns.
The rule creates the Registry, entry point and protocol build identity, and adds
the existing C Runtime. `run.suite` is a discovery filter; it is not a linker
input. One target can have several Suites; a Job is not a Case or a Suite.

```sh
xmake ct                         # run all enabled Jobs
xmake ct --list --json
xmake ct --plan unit.math
xmake ct --doctor --level=unit
xmake ct --describe --json
xmake ct --level=unit,component --tag=host,math
xmake ct --suite='math_*' --case=adds unit.math
xmake ct --test-profile=ci --reporter=json,junit
xmake ct --output-dir=out/test-results unit.math
```

Job patterns and levels are OR; tags are AND; dimensions are AND. List/plan
retain disabled Jobs; run excludes them. Xmake 3.1.1 repeats of a kv option are
**last-wins**, so use comma-separated values. `--test-profile` selects a Cautest
profile, leaving Xmake's own `--profile` untouched. Exit codes retain the old
CLI: 0 success, 1 test failure, 2 execution/infrastructure error, 3 invalid
configuration, 4 empty selection, 130 interruption (POSIX parents can observe SIGINT instead; shells map it to 130). Diagnostics go to stderr;
`--json` stdout stays parseable when the corresponding old CLI command produces
JSON (empty selection intentionally does not create a result JSON).

## Build and runtime boundary

The actual chain is Xmake task → fixed Node module → existing Workflow build
Step → `xmake build` in the **same project** → actual target-file query → strict
receipt → unchanged Native/MCU CTP runtime → existing Result/JSON/JUnit engine.
No Lua source, function body, arbitrary expression or CLI plan JSON is executed
as a manifest. User-specified provider modules are trusted local configuration,
just like existing `.mjs` configuration files.

A receipt keeps output roles, byte SHA-256, build context and CTP
`protocolBuildId` separate. Unknown/missing/corrupt residual outputs trigger a
real rebuild; failed builds cannot reuse old binaries. Shared target builds
are deduplicated per invocation. A second Job with conflicting build env is
rejected; use explicit independent targets/configurations for such Jobs.
Persistent build receipts are env-keyed. Source changes during a run are errors.
Xmake configuration/output contexts must be isolated explicitly; Cautest does
not invent inheritance from an application target, configure cross toolchains,
or guess firmware/module outputs by suffix.

For secondary outputs, declare explicit roles on the real target:

```lua
add_values("cautest.outputs", "firmware-bin=output/image.bin")
add_values("cautest.protocolBuildId", "identity-embedded-by-the-firmware-build")
```

The primary role comes from `target:targetfile()`. Select another with
`ctest.mcu {target="firmware", output="firmware-bin", ...}`. Every declared
output is checked, not only the selected role. A phony/custom target needs
explicit output roles. The internal `cautest-artifact` task only loads target
metadata; it never compiles. The Native rule reads the identity emitted during
the actual build; it does not regenerate sources during this query. User target
load hooks remain user-controlled.

## Reuse product code explicitly

The [two-module example](../../examples/xmake/native/xmake.lua) demonstrates a
shared source rule and a separately compiled static library. A consumer's
private macros **do not** change an already compiled dependency library; shared
source rules recompile in each consumer. Keep product `main`, mocks and test
entry points explicit. Cautest never clones a production target or attempts to
copy its include paths/flags/defines automatically.

For generated headers, the producer target must declare Xmake
`set_policy("build.fence", true)`, and consumers must `add_deps` on it. Ordinary
link dependencies alone allow compilation in parallel and are not a header
generation fence. The Native Registry and entry are generated after that fence
in the first build, not during target loading. A content-sensitive compile
definition and GNU-compatible linker build-ID flag invalidate both compile
and link timestamp caches, including same-second updates. The Native rule
therefore requires a GNU-compatible ELF linker (GCC/ld was actually tested).
See `test/xmake-robustness.test.js` for first-build and changed-header evidence.

Copy `examples/xmake/native` outside this repository, then clone Cautest at that
copy's `tools/cautest`. Prepare the clone before running `xmake ct`. The disabled
negative Job is documentation: `--case=deliberate_failure unit.math` provides an
explicit failing-case demonstration.

## Module workflow providers

```lua
ctest.workflow {
    id = "integration.application",
    provider = {module = "tests/application.mjs", export = "create"},
    artifacts = {app = {target = "application"}}, options = {}
}
```

`create({projectRoot, origin, options, artifacts, getArtifact})` returns the
existing `WorkflowStep`/`WorkflowFragment` or an array of them. Cautest inserts
build Steps after leading prepare Steps. During execution use
`getArtifact(context, "app")`, not hard-coded state keys. The provider must
produce Case results or explicitly opt into an empty-result policy, as before.
Construction must be side-effect-free: list/plan loads workflow modules but
never executes Steps or invokes the build provider.

Board factories use `ctest.board {id, provider={module,export}, options,
resourceId, ownership}` and `ctest.mcu {id,target,board}`. Board modules are
loaded lazily on flash, not on list/plan. Real hardware has not been validated.
The current kernel/driver manifest declarations are recognized for mixed-project
listing, but their artifact-backed runtime is not yet implemented; doctor/run
fails explicitly rather than treating a `.ko` as an executable. Existing
standalone JS kernel/driver helpers remain available.

## Scope and validation

`ctest.include` requires every pattern to match unless `optional=true`. The
collector sorts, deduplicates normalized paths and detects cycles. Duplicate
IDs report both declaration files. Definitions include file, declaration ordinal
and include chain; the ordinal is **not a Lua source line number**. Explicit
includes are required: there is no repository-wide auto-discovery. Reserved
task names `ct` and `cautest-artifact` are diagnosed rather than silently replaced.
Xmake reparses on configuration; the registry resets between interpreter passes.

The implementation is verified on supplied Xmake 3.1.1 Linux x86_64. One pinned
private accessor supplies the current Lua filename. Other versions/platforms,
real MCU SPI and actual UML kernel/driver execution need their respective
acceptance tests before being declared supported.

## MCU artifact adapter and physical locking

The [MCU Host simulation](../../examples/xmake/mcu-simulated/xmake.lua) builds
real C firmware code with Xmake, then runs the existing freestanding reference
MCU/CTP transport with fragmented I/O. `cautest.mcu-simulated` generates an
explicit Registry and embeds a 24-hex protocol identity (the reference MCU
storage is 32 bytes including termination). The full input SHA-256 still
invalidates compilation/linking; the output file SHA-256 remains independent.
This is **not** a real MCU target, real startup/linker-script verification or SPI
acceptance. Real firmware is an application-owned target with explicitly
exported firmware output and embedded protocol identity.

Board factories receive `{projectRoot, options, origin, signal}`. They load only
inside provision, after the build and physical lock, and must honor cancellation.
Owned adapters close even after flash/reset failure; borrowed adapters are never
closed by Cautest. Factories that reject after partially allocating resources
must clean up those resources themselves. Arbitrary non-cooperative JavaScript
cannot be forcibly canceled; do not start untracked asynchronous device work.
A factory resolving after cancellation has its owned adapter closed before any
flash. Per-Job board/log names prevent two aliases overwriting each other's logs.

`resourceId` is **required** for a Board. Distinct aliases of one probe/serial
number must use the same ID. Actual Linux `flock` serializes cooperating processes
of the same OS user, independently of project location. The lock directory is
`$CAUTEST_LOCK_DIR` or a per-user directory under the OS temp directory. All
participants must use the same lock directory and physical ID. `lockTimeoutMs`
defaults to 30000. Doctor checks for `flock`; waiting is cancelable; the kernel
releases ownership after owner process death. Lockfiles are intentionally never
unlinked, avoiding races between old and new lockfile inodes. Release runs after
board/transport cleanup, even when an earlier cleanup fails. This is advisory
coordination, not access control against other OS users or tools ignoring it.

Tests cover real Xmake → firmware → MCU CTP, two aliases/one build, one-time
serial disconnect recovery, owned/borrowed failure cleanup, stale board firmware,
wrong Boot ID, busy-lock timeout, canceled wait and forced owner process death.
No physical board was supplied; real flash/reset/power/serial/SPI acceptance
remains outstanding. Kernel/Driver artifact runtimes remain explicitly unsupported.
