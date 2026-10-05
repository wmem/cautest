import("core.base.option")
import("core.project.project")

function main()
    local directory = os.scriptdir()
    local entry = path.join(directory, "runtime/xmake.lua")
    assert(
        os.isfile(entry),
        "插件尚未准备：请通过索引仓库安装，或先执行 scripts/prepare-addon.lua"
    )
    assert(
        os.isfile(project.rootfile()),
        "Cautest 需要工程 xmake.lua；请在工程目录执行或使用 -P 指定工程"
    )
    local args = { "ct", "-P", os.projectdir(), "-F", project.rootfile() }
    -- 原样保留既有参数及退出码，复用成熟的 Lua 配置解析和 Node 执行链路。
    for _, key in ipairs({
        "config",
        "level",
        "tag",
        "suite",
        "case",
        "parameter",
        "include",
        "exclude",
        "test-profile",
        "reporter",
        "output-dir",
        "case-timeout",
        "run-timeout",
        "suite-policy",
        "node",
        "confirm",
    }) do
        local value = option.get(key)
        if value then
            table.insert(args, "--" .. key .. "=" .. value)
        end
    end
    for _, key in ipairs({
        "list",
        "plan",
        "doctor",
        "describe",
        "json",
        "fail-fast",
        "verbose",
        "diagnosis",
        "quiet",
        "yes",
        "root",
    }) do
        if option.get(key) then
            table.insert(args, "--" .. key)
        end
    end
    table.join2(args, option.get("jobs") or {})
    local rcfiles = { path.join(directory, "bridge.lua") }
    if os.getenv("XMAKE_RCFILES") then
        table.join2(rcfiles, path.splitenv(os.getenv("XMAKE_RCFILES")))
    end
    local code = os.execv(os.programfile(), args, {
        curdir = os.workingdir(),
        try = true,
        envs = { XMAKE_RCFILES = path.joinenv(rcfiles), CAUTEST_ADDON_ENTRY = entry },
    })
    os.exit(code or 2)
end
