-- 普通固件构建也可使用运行时规则，不自动加载或执行 ctest.lua。
local runtime = path.absolute("../../plugins/ctest/runtime", os.scriptdir())
includes(path.join(runtime, "adapters/xmake-test/rules/native.lua"))
