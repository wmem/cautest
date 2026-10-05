import path from "node:path";
import {readFile, realpath} from "node:fs/promises";
import {stableSerialize} from "../cache/fingerprint.js";
import {fileState} from "../cache/file-state.js";
import {object, type ResolvedArtifact} from "../artifacts/index.js";
import {CAUTEST_VERSIONS} from "../config/versions.js";
import {CautestError} from "../model/error.js";
import type {KernelModuleArtifact} from "./module-build.js";
import type {GuestProgramArtifact} from "../uml/runtime.js";

/** A kernel ABI/build identity, not a CTP HELLO identity or an Xmake configuration. */
export interface KernelArtifactContext {
  readonly schemaVersion: 2;
  readonly kind: "cautest.kernel-context";
  readonly outputDir: string;
  readonly arch: string;
  readonly crossCompile: string;
  readonly release: string;
  readonly configState: Awaited<ReturnType<typeof fileState>>;
  readonly symbolsState: Awaited<ReturnType<typeof fileState>>;
  readonly imageState: Awaited<ReturnType<typeof fileState>>;
  readonly imagePath: string;
}
function fail(message: string): never { throw new CautestError(message, {code: "build_error"}); }
export async function captureKernelContext(outputDir: string, options: {readonly arch?: string; readonly crossCompile?: string; readonly target?: string} = {}): Promise<KernelArtifactContext> {
  const root = await realpath(outputDir);
  const imagePath = await realpath(path.join(root, options.target ?? "linux"));
  const [configState, symbolsState, imageState, release] = await Promise.all([
    fileState(path.join(root, ".config")), fileState(path.join(root, "Module.symvers")),
    fileState(imagePath), readFile(path.join(root, "include/config/kernel.release"), "utf8"),
  ]);
  if (!release.trim() || /\s/u.test(release.trim())) fail("Invalid Kernel release identity");
  return Object.freeze({schemaVersion: CAUTEST_VERSIONS.schemas.kernelContext, kind: "cautest.kernel-context", outputDir: root,
    arch: options.arch ?? "um", crossCompile: options.crossCompile ?? "", release: release.trim(), configState, symbolsState, imageState, imagePath});
}
export function validateKernelContext(value: unknown): asserts value is KernelArtifactContext {
  const v = object(value, ["schemaVersion", "kind", "outputDir", "arch", "crossCompile", "release", "configState", "symbolsState", "imageState", "imagePath"], "Kernel context");
  if (v.schemaVersion !== CAUTEST_VERSIONS.schemas.kernelContext || v.kind !== "cautest.kernel-context") fail("Unsupported Kernel context schema/kind");
  if (typeof v.outputDir !== "string" || !path.isAbsolute(v.outputDir)) fail("Kernel context outputDir must be absolute");
  if (typeof v.imagePath !== "string" || !path.isAbsolute(v.imagePath)) fail("Kernel imagePath must be absolute");
  for (const key of ["arch", "release"]) if (typeof v[key] !== "string" || !v[key] || /\s/u.test(v[key] as string)) fail(`Invalid Kernel context ${key}`);
  if (typeof v.crossCompile !== "string") fail("Invalid Kernel crossCompile");
  for (const key of ["configState", "symbolsState", "imageState"]) { const state = v[key] as Record<string,unknown> | undefined; if (!state || typeof state.size !== "number" || typeof state.mtimeNs !== "string" || typeof state.mode !== "number") fail(`Invalid Kernel context ${key}`); }
}
export function assertKernelContext(expected: KernelArtifactContext, actual: unknown): void {
  validateKernelContext(actual);
  if (stableSerialize(expected) !== stableSerialize(actual)) fail("Kernel artifact context mismatch: module was built for another Kernel/configuration; rebuild from the shared Environment");
}

/** Bounds-checked ELF64 reader: modules must be relocatable, guests must be static x86_64 executables. */
function elf64(bytes: Buffer, label: string): {type: number; phoff: number; phsize: number; phnum: number} {
  if (bytes.length < 64 || !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || bytes[4] !== 2 || bytes[5] !== 1 || bytes[6] !== 1) fail(`${label}: expected little-endian ELF64`);
  if (bytes.readUInt16LE(18) !== 62) fail(`${label}: expected x86_64 ELF (the supported UML guest architecture)`);
  const phoff = Number(bytes.readBigUInt64LE(32));
  const phsize = bytes.readUInt16LE(54), phnum = bytes.readUInt16LE(56);
  if (!Number.isSafeInteger(phoff) || phoff < 0 || phoff > bytes.length || (phnum > 0 && (phsize < 56 || phoff + phnum * phsize > bytes.length))) fail(`${label}: invalid ELF program headers`);
  return {type: bytes.readUInt16LE(16), phoff, phsize, phnum};
}
export async function consumeKernelModule(artifact: ResolvedArtifact, expected: KernelArtifactContext, name: string): Promise<KernelModuleArtifact> {
  if (!artifact.path.endsWith(".ko")) fail("Kernel artifacts must select a .ko output role, never an executable");
  const role = (key: string) => { const found = artifact.receipt.outputs.find(item => item.role === key); if (!found) fail(`Kernel module ${artifact.receipt.target} is missing output role ${key}`); return found.path; };
  const raw: unknown = JSON.parse(await readFile(role("kernel-context"), "utf8"));
  assertKernelContext(expected, raw);
  const bytes = await readFile(artifact.path);
  if (elf64(bytes, artifact.path).type !== 1) fail("Kernel module must be an ELF relocatable object (ET_REL)");
  const offset = bytes.indexOf(Buffer.from("vermagic="));
  const end = offset < 0 ? -1 : bytes.indexOf(0, offset);
  if (offset < 0 || end < 0 || bytes.subarray(offset + 9, end).toString("utf8").split(" ")[0] !== expected.release) fail("Kernel module vermagic does not match the shared Environment release");
  return {name, module: artifact.path, symbols: role("symbols"), modulesOrder: role("order"), cacheKey: artifact.buildId || artifact.receipt.target,
    cacheHit: false, coverageNotes: [], coverageSources: []};
}
export async function consumeDriverGuest(artifact: ResolvedArtifact, name: string): Promise<GuestProgramArtifact> {
  if (!artifact.buildId) fail("Driver Guest requires an explicit protocolBuildId");
  const bytes = await readFile(artifact.path), elf = elf64(bytes, artifact.path);
  if (elf.type !== 2 && elf.type !== 3) fail("Driver Guest must be an executable, not a .ko or library");
  for (let index = 0; index < elf.phnum; index++) {
    const off = elf.phoff + index * elf.phsize, type = bytes.readUInt32LE(off);
    if (type === 3) fail("Driver Guest must be statically linked; use cautest.driver-guest (PT_INTERP is unsupported)");
    if (type === 2) {
      const offset = Number(bytes.readBigUInt64LE(off + 8)), size = Number(bytes.readBigUInt64LE(off + 32));
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > bytes.length || size % 16) fail("Invalid guest ELF dynamic segment");
      for (let entry = offset; entry < offset + size; entry += 16) {
        const tag = bytes.readBigUInt64LE(entry);
        if (tag === 0n) break;
        if (tag === 1n) fail("Driver Guest may not depend on guest shared libraries (DT_NEEDED)");
      }
    }
  }
  return {name, path: artifact.path, buildId: artifact.buildId, endpoint: name, installPath: `/opt/cautest/bin/${name}`, cacheHit: false};
}
