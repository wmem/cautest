import("core.base.option")
import("core.project.project")

-- JS 工程直接交给原生 CLI；尚未迁移的 Lua 工程继续使用原执行入口。
function main()
    local root = os.projectdir()
    local config = option.get("config")
    if not config then
        for _, name in ipairs({ "cautest.config.mjs", "cautest.config.js", "cautest.config.cjs" }) do
            if os.isfile(path.join(root, name)) then
                config = name
                break
            end
        end
    end
    if not config or path.extension(config) == ".lua" then
        return import("legacy", { rootdir = os.scriptdir() }).main()
    end
    config = path.absolute(config, root)
    assert(os.isfile(config), "测试配置不存在：" .. config)
    project.load_targets()
    local prepare = project.get("target.values.cautest.prepare")
    if prepare then
        assert(type(prepare) == "string", "cautest.prepare 必须是一个任务名")
        -- 准备任务输出不混入 CLI 的 JSON stdout；失败直接终止。
        os.iorunv(
            os.programfile(),
            { prepare, "-P", root, "-F", project.rootfile() },
            { curdir = root }
        )
    end
    local entry = path.join(os.scriptdir(), "runtime/cautest.js")
    assert(os.isfile(entry), "插件缺少原生 CLI，请通过新版分发配方重新准备")
    local command = "run"
    local count = 0
    for _, name in ipairs({ "list", "plan", "doctor", "describe" }) do
        if option.get(name) then
            command = name
            count = count + 1
        end
    end
    assert(count <= 1, "list/plan/doctor/describe 只能选择一个")
    local args = { entry, "--config", config, command }
    local mappings = { ["test-profile"] = "profile" }
    local repeated = {
        level = true,
        tag = true,
        suite = true,
        case = true,
        parameter = true,
        include = true,
        exclude = true,
        reporter = true,
    }
    for _, name in ipairs({
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
    }) do
        local value = option.get(name)
        if value then
            local values = repeated[name] and value:split(",", { plain = true }) or { value }
            for _, item in ipairs(values) do
                table.insert(args, "--" .. (mappings[name] or name))
                table.insert(args, item)
            end
        end
    end
    for _, name in ipairs({ "json", "fail-fast", "verbose" }) do
        if option.get(name) then
            table.insert(args, "--" .. name)
        end
    end
    table.join2(args, option.get("jobs") or {})
    -- 不导出 Lua manifest，不注入 RCFILES，不生成测试 target。
    local code = os.execv(option.get("node") or "node", args, { curdir = root, try = true })
    os.exit(code or 2)
end
