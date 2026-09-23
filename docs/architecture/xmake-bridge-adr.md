# Xmake bridge ADR (2026-09-23)

Verified runtime: supplied Xmake **3.1.1+HEAD.3ba37a0**, Linux x86_64, Node 22.
This is the initial tested combination, not a claim about older releases or other hosts.

A custom task does not hold the build lock while waiting for Node. The real PoC
runs `xmake ct → Node → xmake build -y app` in the **same project** without a
recursive ct invocation or deadlock. Build errors propagate. Ordinary product
builds do not use Node. `test/xmake-poc.test.js` runs this path in a new directory.

Xmake description-file globals are not a reliable table-export mechanism.
Register the table once per interpreter through `interp_add_scopeapis`' custom
callback and `interp:api_register_builtin`. Keep registry state in the callback's
closure. Do not install a global external Lua interpreter or evaluate Lua in Node.

Xmake 3.1.1 `kv` options are **last-wins** when repeated. The adapter therefore
accepts comma-separated lists (`--level=unit,component`, `--tag=native,fast`),
not an invented promise that repeated flags accumulate. Positional `vs` keeps
all Job IDs. Reserve `--test-profile` for Cautest; leave Xmake `--profile` alone.

This PoC is only the lock/CLI/export foundation. Full signal propagation,
collector diagnostics, artifact identity and build-reuse acceptance must be
verified separately before the corresponding gates are marked PASS.

Run with `CAUTEST_XMAKE=/absolute/path/xmake node --test test/xmake-poc.test.js`.

## Shared cancellation correction

The pre-adapter command runner terminated only the direct child. It now starts
a POSIX process group and terminates/escalates the entire group on cancellation,
including descendants that close stdio or ignore SIGTERM. This is shared by the
old helpers and new Xmake provider, not a second adapter-only cancellation engine.
Linux process-tree, pre-abort, spawn-error, old interrupt/Native/MCU regressions:
18/18 passed; see the process-tree evidence in `docs/tests/evidence/`. Windows
uses the previous direct-child fallback and is not in the Xmake support matrix.
