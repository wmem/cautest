import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CacheClient, createFingerprint, resolveCautestC, stableSerialize } from "../dist/config/index.js";

async function temporary(t) { const directory = await mkdtemp(path.join(os.tmpdir(), "cautest-cache-")); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }

test("Fingerprint 对键和文件顺序稳定并感知内容变化", async (t) => {
  const directory = await temporary(t); await writeFile(path.join(directory, "a.c"), "a"); await writeFile(path.join(directory, "b.c"), "b");
  const first = await createFingerprint({ files: ["b.c", "a.c"], env: { Z: "2", A: "1" }, values: { b: 2, a: 1 } }, { baseDir: directory });
  const second = await createFingerprint({ files: ["a.c", "b.c"], values: { a: 1, b: 2 }, env: { A: "1", Z: "2" } }, { baseDir: directory });
  assert.equal(first, second); await writeFile(path.join(directory, "a.c"), "changed"); assert.notEqual(await createFingerprint({ files: ["a.c", "b.c"], env: { A: "1", Z: "2" }, values: { a: 1, b: 2 } }, { baseDir: directory }), first);
  assert.equal(stableSerialize({ z: 1, a: [2, 3] }), '{"a":[2,3],"z":1}');
});

test("Cache 覆盖 Miss/Hit、缺失输出、损坏和 Disable", async (t) => {
  const directory = await temporary(t); const source = path.join(directory, "program.elf"); const restored = path.join(directory, "out/program.elf"); await writeFile(source, "firmware-v1");
  const fingerprint = await createFingerprint({ values: { version: 1 } }); const cache = new CacheClient({ root: path.join(directory, "cache") });
  assert.equal((await cache.inspect(fingerprint)).reason, "missing"); assert.equal((await cache.store(fingerprint, [{ name: "elf", path: source }])).stored, true); assert.equal((await cache.restore(fingerprint, [{ name: "elf", path: restored }])).hit, true); assert.equal(await readFile(restored, "utf8"), "firmware-v1");
  const cached = path.join(directory, "cache", fingerprint, "files/elf"); await unlink(cached); assert.equal((await cache.inspect(fingerprint)).reason, "missing-output"); await mkdir(path.dirname(cached), { recursive: true }); await writeFile(cached, "wrong"); assert.equal((await cache.inspect(fingerprint)).reason, "corrupt");
  const disabled = new CacheClient({ root: path.join(directory, "disabled"), enabled: false }); assert.deepEqual(await disabled.store(fingerprint, [{ name: "elf", path: source }]), { stored: false, reason: "disabled" });
});

test("Cache 原子发布并接受并发同内容 Writer", async (t) => {
  const directory = await temporary(t); const source = path.join(directory, "output"); await writeFile(source, "same"); const fingerprint = await createFingerprint({ values: { atomic: true } });
  const clients = [new CacheClient({ root: path.join(directory, "cache") }), new CacheClient({ root: path.join(directory, "cache") })]; const results = await Promise.all(clients.map((cache) => cache.store(fingerprint, [{ name: "output", path: source }])));
  assert.equal(results.filter((item) => item.stored).length, 1); assert.equal((await clients[0].inspect(fingerprint)).hit, true); await access(path.join(directory, "cache", fingerprint, "files/output"));
});

test("resolveCautestC 返回同版本只读平台资产", () => {
  const kit = resolveCautestC({ platform: "posix" });
  assert.match(kit.includeDir, /assets\/cautest-c\/include$/u); assert.ok(kit.sources.some((item) => item.endsWith("cautest_posix_target.c"))); assert(Object.isFrozen(kit));
});
