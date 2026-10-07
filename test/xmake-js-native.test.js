import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("..", import.meta.url));
const xmake = process.env.CAUTEST_XMAKE ?? "xmake";

test("原生 JS 插件：准备环境、外部目录执行、参数转发、报告及失败退出", {timeout: 60000}, async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cautest JS 插件 "));
    t.after(() => rm(root, {recursive: true, force: true}));
    const plugin = path.join(root, "plugin");
    const runtime = path.join(plugin, "runtime");
    const project = path.join(root, "project");
    await mkdir(runtime, {recursive: true});
    await mkdir(project);
    for (const name of ["main.lua", "legacy.lua", "xmake.lua"]) {
        await cp(path.join(source, "addon/plugins/ctest", name), path.join(plugin, name));
    }
    for (const name of ["dist", "assets", "package.json", "versions.json", "cautest.js"]) {
        await cp(path.join(source, name), path.join(runtime, name), {recursive: true});
    }
    const projectfile = path.join(project, "xmake.lua");
    await writeFile(projectfile, `set_values("cautest.prepare", "prepare-tests")
target("product")
    set_kind("phony")
target_end()
task("prepare-tests")
    set_menu({options = {}})
    on_run(function ()
        assert(not os.isfile(path.join(os.projectdir(), "prepare-fails")), "准备失败")
        io.writefile(path.join(os.projectdir(), "toolchain.json"), '{"compiler":"cc"}')
        print("此准备输出不能混入 JSON")
    end)
task_end()
includes(${JSON.stringify(path.join(plugin, "xmake.lua"))})
`);
    await writeFile(path.join(project, "case.c"), '#include <cautest/cautest.h>\nCAUTEST_CASE(pass) { CAUTEST_EXPECT_EQ_INT(1, 1); }\nCAUTEST_CASE(fail) { CAUTEST_EXPECT_EQ_INT(1, 2); }\nCAUTEST_SUITE(sample, CAUTEST_CASE_ENTRY(pass), CAUTEST_CASE_ENTRY(fail));\n');
    await writeFile(path.join(project, "cautest.config.mjs"), `import {readFileSync} from 'node:fs';
import {nativeCTestJob,testConfig} from '@cautest/config.js';
const build=JSON.parse(readFileSync(new URL('./toolchain.json',import.meta.url),'utf8'));
export default testConfig({jobs:[nativeCTestJob({id:'unit.sample',tags:['native','fast'],tests:['case.c'],suites:['sample'],build})]});\n`);
    const invoke = (...args) => execFileSync(xmake, ["ctest", "-P", project, "-F", projectfile, ...args], {cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
    const listed = JSON.parse(invoke("--list", "--json"));
    assert.equal(listed[0].id, "unit.sample");
    assert.equal(JSON.parse(await readFile(path.join(project, "toolchain.json"), "utf8")).compiler, "cc");
    assert.match(invoke("--plan"), /nativeCompile/);
    const passing = invoke("--case=pass", "--tag=native,fast", "--reporter=json,junit", "--json", "unit.sample");
    const result = JSON.parse(passing);
    assert.equal(result.status, "SUCCESS");
    assert.throws(() => invoke("--case=fail", "unit.sample"), error => error.status === 1);
    await writeFile(path.join(project, "prepare-fails"), "");
    assert.throws(() => invoke("--list", "--json"), error => error.status !== 0 && /准备失败/.test(`${error.stdout}\n${error.stderr}`));
});
