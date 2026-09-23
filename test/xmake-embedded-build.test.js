import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {mkdtemp, mkdir, symlink, writeFile, readFile, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const xmake = process.env.CAUTEST_XMAKE;
const kit = fileURLToPath(new URL('..', import.meta.url));
const env = {...process.env, XMAKE_ROOT: 'y', XMAKE_COLORTERM: 'nocolor'};
function invoke(root, program, args, success = true) {
  const result = spawnSync(program, args, {cwd: root, env, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024});
  assert.ifError(result.error);
  if (success) assert.equal(result.status, 0, result.stdout + result.stderr);
  return result;
}
function section(elf, name) {
  assert.equal(elf.toString('hex', 0, 4), '7f454c46'); assert.equal(elf[4], 1); assert.equal(elf[5], 1);
  assert.equal(elf.readUInt16LE(18), 40, 'Must be an ARM ELF, not a host simulation executable');
  const at = elf.readUInt32LE(32), count = elf.readUInt16LE(48), size = elf.readUInt16LE(46);
  const str = at + elf.readUInt16LE(50) * size, strings = elf.readUInt32LE(str + 16);
  for (let i = 0; i < count; i++) {
    const pos = at + i * size, begin = strings + elf.readUInt32LE(pos);
    if (elf.toString('utf8', begin, elf.indexOf(0, begin)) === name) return {address: elf.readUInt32LE(pos + 12), offset: elf.readUInt32LE(pos + 16), size: elf.readUInt32LE(pos + 20)};
  }
  assert.fail(`Missing ELF section ${name}`);
}

test('real Cortex-M ELF/BIN build preserves explicit startup/linker files and per-consumer product macros (not hardware execution)', {skip: !xmake}, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'ct-arm-build-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  for (const program of ['clang', 'ld.lld', 'llvm-objcopy']) invoke(root, program, ['--version']);
  await mkdir(path.join(root, 'tools')); await symlink(kit, path.join(root, 'tools/cautest'), 'dir');
  await writeFile(path.join(root, 'startup.c'), `extern unsigned _stack_top;\nextern unsigned read_product(void);\nvoid Reset_Handler(void) { *(volatile unsigned *)0x20000000 = read_product(); for (;;) __asm volatile("wfi"); }\n__attribute__((section(".isr_vector"),used)) void * const vectors[] = {&_stack_top, (void *)Reset_Handler};\n`);
  await writeFile(path.join(root, 'product.c'), `#if !defined(PRODUCT_VALUE)\n#error product variant must be supplied by its consumer\n#endif\n__attribute__((section(".product_value"),used)) const unsigned product_value = PRODUCT_VALUE;\nunsigned read_product(void) {return product_value;}\n`);
  const variants = [{name: 'fw_a', flash: 0x08000000, ramSize: 16384, value: 17}, {name: 'fw_b', flash: 0x08010000, ramSize: 8192, value: 29}];
  for (const v of variants) await writeFile(path.join(root, v.name + '.ld'), `ENTRY(Reset_Handler)\nMEMORY { FLASH (rx) : ORIGIN = ${v.flash}, LENGTH = 32K\n RAM (rwx) : ORIGIN = 0x20000000, LENGTH = ${v.ramSize} }\n_stack_top = ORIGIN(RAM) + LENGTH(RAM);\nSECTIONS { .isr_vector : { KEEP(*(.isr_vector)) } >FLASH\n .text : { *(.text*) *(.rodata*) } >FLASH\n .product_value : { KEEP(*(.product_value)) } >FLASH\n .ARM.exidx : { *(.ARM.exidx*) } >FLASH\n .data : { *(.data*) } >RAM AT>FLASH\n .bss (NOLOAD) : { *(.bss*) *(COMMON) } >RAM }\n`);
  const definition = `set_project("embedded-build-contract")\nset_languages("c11")\nincludes("tools/cautest/xmake.lua")\n` + variants.map(v => `target("${v.name}")\nset_kind("binary")\nset_toolchains("clang")\nset_targetdir("build/${v.name}")\nset_objectdir("build/.objs/${v.name}")\nset_filename("firmware.elf")\nadd_files("startup.c", "product.c")\nadd_defines("PRODUCT_VALUE=${v.value}")\nadd_cflags("--target=arm-none-eabi", "-mcpu=cortex-m3", "-mthumb", "-ffreestanding", "-fno-builtin", {force=true})\nadd_ldflags("--target=arm-none-eabi", "-mcpu=cortex-m3", "-mthumb", "-nostdlib", "-fuse-ld=lld", "-Wl,-T," .. path.absolute("${v.name}.ld"), {force=true})\nafter_build(function(target) os.vrunv("llvm-objcopy", {"-O", "binary", target:targetfile(), path.join(target:targetdir(), "firmware.bin")}) end)\ntarget_end()\n`).join('');
  await writeFile(path.join(root, 'xmake.lua'), definition);
  invoke(root, xmake, ['f', '-y', '-p', 'cross', '-a', 'arm']);
  const hashes = [];
  for (const v of variants) {
    invoke(root, xmake, ['build', v.name]);
    const elf = await readFile(path.join(root, 'build', v.name, 'firmware.elf'));
    const bin = await readFile(path.join(root, 'build', v.name, 'firmware.bin'));
    const vector = section(elf, '.isr_vector'), value = section(elf, '.product_value');
    assert.equal(vector.address, v.flash); assert.equal(vector.size, 8);
    assert.equal(bin.readUInt32LE(0), 0x20000000 + v.ramSize);
    assert.equal(bin.readUInt32LE(4), elf.readUInt32LE(24)); assert.equal(bin.readUInt32LE(4) & 1, 1);
    assert.equal(elf.readUInt32LE(value.offset), v.value); assert.equal(bin.readUInt32LE(value.address - v.flash), v.value);
    const symbols = invoke(root, 'readelf', ['-s', path.join(root, 'build', v.name, 'firmware.elf')]).stdout;
    assert.doesNotMatch(symbols, /cautest_generated_registry|cautest_posix_target/);
    hashes.push(createHash('sha256').update(bin).digest('hex'));
  }
  assert.notEqual(hashes[0], hashes[1]);
  await writeFile(path.join(root, 'duplicate.c'), 'void Reset_Handler(void) {}\n');
  await writeFile(path.join(root, 'xmake.lua'), definition.replaceAll('add_files("startup.c", "product.c")', 'add_files("startup.c", "product.c", "duplicate.c")'));
  invoke(root, xmake, ['f', '-c', '-y', '-p', 'cross', '-a', 'arm']);
  const failed = invoke(root, xmake, ['build', 'fw_a'], false);
  assert.notEqual(failed.status, 0); assert.match(failed.stdout + failed.stderr, /duplicate symbol.*Reset_Handler|multiple definition.*Reset_Handler/);
  assert.equal(createHash('sha256').update(await readFile(path.join(root, 'build/fw_a/firmware.bin'))).digest('hex'), hashes[0], 'Failed link must not publish a new BIN');
  await writeFile(path.join(root, 'xmake.lua'), definition);
  invoke(root, xmake, ['f', '-c', '-y', '-p', 'cross', '-a', 'arm']); invoke(root, xmake, ['build', 'fw_a']);
  console.log('ARM compile-only verification', JSON.stringify({variants, binarySha256: hashes, duplicateStartupRejected: true, recovered: true, firmwareExecuted: false}));
});
