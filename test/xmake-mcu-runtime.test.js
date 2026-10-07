import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const xmake = process.env.CAUTEST_XMAKE;
const arm = spawnSync("arm-none-eabi-gcc", ["--version"]).status === 0;

// 固件入口属于应用；芯片规则在 on_load 中切换平台时，生成目录也必须保持一致。
test("MCU 规则交叉构建公共运行时、保留应用入口及稳定生成目录", { skip: !xmake || !arm }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "cautest-arm-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "xmake.lua"), `
includes(${JSON.stringify(path.join(root, "adapters/xmake-test/rules/native.lua"))})
toolchain("arm-test")
set_kind("standalone")
set_cross("arm-none-eabi-")
set_toolset("cc", "arm-none-eabi-gcc")
set_toolset("ld", "arm-none-eabi-gcc")
on_check(function() return true end)
toolchain_end()
rule("fixture.firmware")
on_load(function(target)
    target:set("plat", "cross")
    target:set("arch", "arm")
    target:set("toolchains", "arm-test")
end)
rule_end()
target("firmware")
set_kind("binary")
add_rules("cautest.mcu", "fixture.firmware")
add_values("cautest.registry.suites", "sample")
add_files("app.c")
add_cflags("-mcpu=cortex-m4", "-mthumb", "-ffreestanding", "-fno-builtin", "-Wall", "-Wextra", "-Werror")
add_ldflags("-mcpu=cortex-m4", "-mthumb", "-nostdlib", "-Wl,-e,main", {force=true})
add_links("gcc")
target_end()
`);
  await writeFile(path.join(directory, "app.c"), `
#include <cautest/mcu.h>
#include "cautest_config.h"
extern const struct cautest_registry cautest_mcu_registry;
CAUTEST_CASE(check) { (void)suite_fixture; (void)case_fixture; (void)cautest_parameter; CAUTEST_EXPECT_EQ_INT(1, 1); }
CAUTEST_SUITE(sample, CAUTEST_CASE_ENTRY(check));
static struct cautest_mcu runtime;
static CAUTEST_WORKSPACE(workspace, CAUTEST_MCU_WORKSPACE_SIZE);
static long receive(void* context, unsigned char* data, unsigned long size) { (void)context; (void)data; (void)size; return 0; }
static int send(void* context, const unsigned char* data, unsigned long size) { (void)context; (void)data; (void)size; return 0; }
int main(void) {
    static const struct cautest_mcu_config config = {
        .protocol = { .registry = &cautest_mcu_registry, .build_id = CAUTEST_MCU_BUILD_ID,
            .boot_id = "boot", .workspace = CAUTEST_WORKSPACE_INIT(workspace), .write = send },
        .read = receive,
    };
    return cautest_mcu_init(&runtime, &config);
}
`);
  const build = () => {
    const result = spawnSync(xmake, ["build", "firmware"], {
      cwd: directory, encoding: "utf8", timeout: 30000,
      env: { ...process.env, XMAKE_ROOT: "y", XMAKE_COLORTERM: "nocolor" },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  build();
  const files = await readdir(path.join(directory, "build"), { recursive: true });
  const identities = files.filter((file) => file.endsWith("cautest/identity.json"));
  assert.equal(identities.length, 1);
  const identity = await readFile(path.join(directory, "build", identities[0]), "utf8");
  assert.match(JSON.parse(identity).protocolBuildId, /^[0-9a-f]{24}$/);
  assert.equal(files.some((file) => file.endsWith("cautest/entry.c")), false);
  build();
  assert.equal(await readFile(path.join(directory, "build", identities[0]), "utf8"), identity);
});
