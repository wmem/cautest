-- 只通过 ctest 子进程的 XMAKE_RCFILES 使用，普通构建不自动加载它。
includes(os.getenv("CAUTEST_ADDON_ENTRY"))
