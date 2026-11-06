import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname);

async function markdownFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", ".cautest", "dist", "node_modules", "release", "output", ".edoc-build"].includes(entry.name)) continue;
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await markdownFiles(child));
    else if (entry.isFile() && /\.(?:md|mdoc)$/u.test(entry.name)) output.push(child);
  }
  return output;
}

// Fenced source excerpts are literal text, not document navigation. In particular,
// archived audits quote Markdown from a different directory without rebasing it.
function markdownOutsideFences(contents) {
  const output = [];
  let fence;
  for (const line of contents.split(/\r?\n/u)) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      if (match && match[1][0] === fence.character && match[1].length >= fence.length && match[2].trim() === "") fence = undefined;
      continue;
    }
    if (match && (match[1][0] === "~" || !match[2].includes("`"))) {
      fence = { character: match[1][0], length: match[1].length };
      continue;
    }
    output.push(line);
  }
  return output.join("\n");
}

async function assertLocalLinks(file) {
  const contents = markdownOutsideFences(await readFile(file, "utf8"));
  for (const match of contents.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
    const target = match[1];
    if (target.startsWith("#") || /^[a-z]+:/u.test(target)) continue;
    await assert.doesNotReject(
      access(path.resolve(path.dirname(file), target.split("#", 1)[0])),
      `${path.relative(root, file)} -> ${target}`,
    );
  }
}

test("Markdown link checks ignore fenced excerpts but retain surrounding prose", () => {
  const content = [
    "[before](README.md)",
    "````markdown", "[excerpt](missing-1.md)", "```", "[still excerpt](missing-2.md)", "````",
    "~~~text", "[tilde excerpt](missing-3.md)", "~~~",
    "[after](docs/index.md)",
  ].join("\n");
  assert.equal(markdownOutsideFences(content), "[before](README.md)\n[after](docs/index.md)");
  assert.equal(markdownOutsideFences("```js\n[unclosed](missing.md)"), "");
  assert.equal(markdownOutsideFences("[real missing link](missing.md)"), "[real missing link](missing.md)");
});

test("除根 README 外所有 Markdown 都在 docs 下且本地链接有效", async () => {
  const files = await markdownFiles(root);
  const outside = files
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .filter((file) => file !== "README.md" && !file.startsWith("docs/"));
  assert.deepEqual(outside, []);
  await Promise.all(files.map(assertLocalLinks));
});

test("Usage 提供按需入口并绑定完整可执行示例", async () => {
  const usageIndex = await readFile(path.join(root, "docs/usage/index.md"), "utf8");
  for (const command of ["doctor", "list", "plan", "run"]) assert.match(usageIndex, new RegExp(`\\b${command}\\b`, "u"));
  for (const entry of [
    "scenarios/native-c.md",
    "scenarios/kernel-uml.md",
    "scenarios/linux-driver-unit.md",
    "scenarios/linux-driver-abi.md",
    "scenarios/mcu-simulated.md",
    "scenarios/system-script.md",
    "writing/workflow.md",
    "writing/project-organization.md",
    "overview.md",
    "reference/config.md",
    "reference/cli.md",
    "reference/results.md",
    "writing/c-tests.md",
    "troubleshooting.md",
  ]) assert.match(usageIndex, new RegExp(entry.replace(".", "\\."), "u"));

  const scenarios = [
    ["scenarios/native-c.md", "c-lib"],
    ["scenarios/kernel-uml.md", "kernel-lib"],
    ["scenarios/linux-driver-unit.md", "linux-driver-unit"],
    ["scenarios/linux-driver-abi.md", "linux-driver"],
    ["scenarios/mcu-simulated.md", "mcu-sim"],
    ["scenarios/system-script.md", "system-script"],
    ["writing/workflow.md", "workflow"],
  ];
  for (const [document, example] of scenarios) {
    const contents = await readFile(path.join(root, `docs/usage/${document}`), "utf8");
    const config = (await readFile(path.join(root, `examples/${example}/cautest.config.mjs`), "utf8")).trim();
    assert.ok(contents.includes(config), `${document} 必须展示 examples/${example} 的完整配置`);
    for (const command of ["doctor", "list", "plan", "run"]) assert.match(contents, new RegExp(`\\b${command}\\b`, "u"), `${document}: ${command}`);
  }

  for (const document of ["scenarios/native-c.md", "scenarios/kernel-uml.md", "scenarios/linux-driver-unit.md", "scenarios/linux-driver-abi.md", "scenarios/mcu-simulated.md", "scenarios/system-script.md"]) {
    const contents = await readFile(path.join(root, `docs/usage/${document}`), "utf8");
    assert.match(contents, /最小/u, `${document}: 最小用法`);
    assert.match(contents, /典型/u, `${document}: 典型用法`);
    assert.match(contents, /reference\/config\.md/u, `${document}: 配置入口`);
  }

  for (const document of ["scenarios/kernel-uml.md", "scenarios/linux-driver-unit.md", "scenarios/linux-driver-abi.md", "troubleshooting.md"]) {
    const contents = await readFile(path.join(root, `docs/usage/${document}`), "utf8");
    for (const field of ["kernel.timeoutMs", "busybox.timeoutMs", "--run-timeout", "C Test Run"]) assert.match(contents, new RegExp(field.replace(".", "\\."), "u"), `${document}: ${field}`);
  }

  const mcu = await readFile(path.join(root, "docs/usage/scenarios/mcu-simulated.md"), "utf8");
  assert.match(mcu, /运行两个 Case/u);
  assert.doesNotMatch(mcu, /只运行一个 Case/u);
});

test("正式入口区分使用与开发路线，开发入口保留实现和验证资料", async () => {
  const home = await readFile(path.join(root, "docs/index.mdoc"), "utf8");
  for (const entry of ["usage/index.md", "usage/reference/index.mdoc", "development/index.mdoc"]) assert.ok(home.includes(entry), entry);
  const index = await readFile(path.join(root, "docs/development/index.mdoc"), "utf8");
  for (const entry of ["context.md", "architecture/", "capabilities/", "acceptance/", "history/"]) assert.ok(index.includes(entry), entry);
  assert.doesNotMatch(index, /尚未实现 `xmake ct`/u);
});

test("安装 Usage 覆盖典型项目、测试模型、公开配置、CLI 和结果契约", async () => {
  const organization = await readFile(path.join(root, "docs/usage/writing/project-organization.md"), "utf8");
  for (const field of ["tests", "sources", "headers", "suites", "**/*_test.c", "nativeCTestJobFactory", "jobNamespace"]) assert.ok(organization.includes(field), `writing/project-organization.md: ${field}`);

  const model = await readFile(path.join(root, "docs/usage/overview.md"), "utf8");
  for (const name of ["TestConfig", "TestJob", "Workflow Step", "nativeCTestJob", "kernelCTestJob", "driverAbiCTestJob", "mcuCTestJob", "scriptSystemTestJob", "defineStep"]) assert.ok(model.includes(name), `overview.md: ${name}`);

  const reference = await readFile(path.join(root, "docs/usage/reference/config.md"), "utf8");
  for (const declaration of ["common.d.ts", "native.d.ts", "kernel.d.ts", "driver.d.ts", "mcu.d.ts", "system.d.ts", "cautest.h"]) assert.ok(reference.includes(declaration), `reference/config.md: ${declaration}`);

  const cli = await readFile(path.join(root, "docs/usage/reference/cli.md"), "utf8");
  for (const command of ["list", "plan", "describe", "doctor", "run", "session", "clean", "help"]) assert.match(cli, new RegExp(`\\b${command}\\b`, "u"), `reference/cli.md: ${command}`);
  for (const code of ["0", "1", "2", "3", "4", "130"]) assert.ok(cli.includes(`| \`${code}\` |`), `reference/cli.md: exit ${code}`);
  for (const contract of ["issues", "不会分配 `runId`", "不会", "标准 Run 结果目录"]) assert.ok(cli.includes(contract), `reference/cli.md: ${contract}`);

  const results = await readFile(path.join(root, "docs/usage/reference/results.md"), "utf8");
  for (const contract of ["预检失败", "退出码 `2`", "issues", "不创建该目录"]) assert.ok(results.includes(contract), `reference/results.md: ${contract}`);
});
