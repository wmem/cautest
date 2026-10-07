-- 只在用户运行 ctest 时加载工程测试配置。
task("ctest")
set_category("plugin")
on_run("main")
set_menu({
    usage = "xmake ctest [options] [Job IDs ...]",
    description = "运行 Cautest 测试，优先读取原生 cautest.config.mjs",
    options = {
        {
            "c",
            "config",
            "kv",
            nil,
            "Test configuration file, relative to the project root (default: cautest.config.mjs).",
        },
        { nil, "list", "k", nil, "List jobs without building or deploying." },
        { nil, "plan", "k", nil, "Show workflows without executing steps." },
        { nil, "doctor", "k", nil, "Check static requirements." },
        { nil, "describe", "k", nil, "Show sources and configuration hash." },
        { nil, "json", "k", nil, "Machine-readable stdout." },
        { nil, "level", "kv", nil, "Comma-separated levels (OR); repeated options are last-wins." },
        { nil, "tag", "kv", nil, "Comma-separated required tags (AND)." },
        { nil, "suite", "kv", nil, "Comma-separated runtime suite patterns." },
        { nil, "case", "kv", nil, "Comma-separated runtime case patterns." },
        { nil, "parameter", "kv", nil, "Comma-separated parameter patterns." },
        { nil, "include", "kv", nil, "Comma-separated C case include patterns." },
        { nil, "exclude", "kv", nil, "Comma-separated C case exclude patterns." },
        { nil, "test-profile", "kv", nil, "Cautest profile (Xmake --profile is unchanged)." },
        { nil, "reporter", "kv", nil, "console,json,junit,html" },
        { nil, "output-dir", "kv", nil, "Result directory, relative to project root." },
        { nil, "case-timeout", "kv", nil, "Per-case timeout in milliseconds." },
        { nil, "run-timeout", "kv", nil, "C Test run timeout in milliseconds." },
        { nil, "suite-policy", "kv", nil, "CONTINUE/STOP_ON_FAIL/STOP_ON_ERROR" },
        { nil, "fail-fast", "k", nil, "Stop after the first failing job." },
        { nil, "node", "kv", nil, "Explicit Node executable; no automatic installation." },
        { nil, "jobs", "vs", nil, "Job ID glob patterns (OR)." },
    },
})
