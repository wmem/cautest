# Artifact contract v1

`src/artifacts/index.ts` defines the authoritative public types and strict receipt
validator. Version fields are independent of the unchanged CTP 3.1 and Result v1.

An `ArtifactRef` has an engineering target name and an optional output role
(default `primary`). It contains no copy of sources, compiler flags or macros.
A Build Provider is invoked only from the existing Workflow build phase. Its
receipt contains target, absolute project/build paths, platform/architecture/mode,
optional configuration SHA-256, a list of unique named file outputs with byte size
and SHA-256, and an optional `protocolBuildId`.

The content digest is NOT the ID embedded in the CTP HELLO. Native and MCU runtime
consumption requires a nonempty protocol ID; general workflow artifacts can opt
out. Resolve validates every output, not just a guessed filename, checks context,
and re-hashes actual bytes. Wrong schema, target, role, context, missing files,
corrupt files and missing protocol identity fail in build before run/provision.

`nativeArtifactJob` and `mcuArtifactJob` use the **same runtime Step factories** as
`nativeCTestJob` and `mcuCTestJob`. Providers and adapters use `artifactBuildStep`
and `getArtifact`; they never write the old private Native/Firmware state keys.
No new scheduler, CTP engine, reporter or compiler cache is introduced.

MCU owned-board cleanup is now registered before flash/reset, so a preparation
failure also closes the adapter. Borrowed-board ownership remains respected.
Resource locking is a separate requirement, not yet provided by this contract.

`test/artifact.test.js` checks strict invalid receipts, failure gating, real Native
and simulated-MCU CTP parity, and owned/borrowed flash/reset failure cleanup.
