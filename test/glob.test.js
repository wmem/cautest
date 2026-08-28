import assert from "node:assert/strict";
import test from "node:test";
import { globBase, globMatcher } from "../dist/pattern/glob.js";

test("内置 Glob 覆盖路径、Globstar、字符组、花括号和正则特殊字符", () => {
  const sources = globMatcher("src/**/{alpha,beta}.[ch]");
  assert.equal(sources("src/alpha.c"), true);
  assert.equal(sources("src/nested/beta.h"), true);
  assert.equal(sources("src/nested/beta.cpp"), false);
  assert.equal(sources("other/alpha.c"), false);
  assert.equal(globMatcher("unit.[!x]?+")("unit.ab+"), true);
  assert.equal(globMatcher("unit.[!x]?+")("unit.xb+"), false);
  assert.equal(globMatcher("*.c")("nested/a.c"), false);
  assert.equal(globMatcher("**/*.c")("a.c"), true);
  assert.equal(globMatcher("alpha/*", { matchSlash: true })("alpha/nested/case"), true);
  assert.equal(globMatcher("*@one", { matchSlash: true })("alpha/parameter@one"), true);
  assert.equal(globMatcher("literal.(test)")("literal.(test)"), true);
});

test("Glob 静态遍历根不会越过第一个元字符", () => {
  assert.equal(globBase("src/generated/file.c"), "src/generated/file.c");
  assert.equal(globBase("src/**/{a,b}.c"), "src");
  assert.equal(globBase("*.c"), ".");
  assert.equal(globBase("{src,test}/**/*.c"), ".");
});
