-- Tested with Xmake 3.1.1. One registry per project interpreter, never per target.
local fail = ctest and ctest._fail
local previous_task = ctest and ctest._originalTask
local function check(condition, message)
    if not condition then fail(message) end
    return condition
end
local toolroot = path.directory(path.directory(os.scriptdir()))
if ctest then
    if not check(ctest._cautest_root == toolroot, "ctest API already belongs to another tool/checkout") then return end
    if ctest._samePass() then return end
end
local state = {jobs = {}, boards = {}, environments = {}, sources = {}, visited = {}, active = {}, chain = {}, ids = {}, project = {}, errors = {}}
local moduledir = path.join(os.scriptdir(), "modules")
interp_add_scopeapis({values = {{"cautest_initialize", function (interp)
    -- Description errors must not abort task discovery (Xmake hides them as "invalid task").
    fail = function (message) table.insert(state.errors, message) end
    local generation = interp:scriptfiles()
    local function source()
        -- Xmake 3.1.1 has scriptdir(), but no public current-script-file accessor.
        -- Keep this version-pinned dependency in exactly one place.
        local file = path.absolute(interp._PRIVATE._CURFILE)
        state.sources[file] = true
        return file
    end
    local function fields(value, allowed, label)
        if not check(type(value) == "table", label .. " must be a table") then return end
        for key, _ in pairs(value) do
            if not check(table.contains(allowed, key), label .. ": unknown field " .. tostring(key)) then return end
        end
        return true
    end
    local function declaration(kind, input)
        local file = source()
        if not check(type(input) == "table", file .. ": ctest." .. kind .. " requires a table") then return end
        if not check(type(input.id) == "string" and #input.id > 0, file .. ": Job/resource id is required") then return end
        local category = (kind == "board" and "boards") or (kind == "environment" and "environments") or "jobs"
        local key = category .. ":" .. input.id
        if not check(not state.ids[key], "Duplicate " .. key .. ": " .. tostring(state.ids[key]) .. " and " .. file) then return end
        state.ids[key] = file
        local copy = table.clone(input)
        copy.kind = kind
        copy.origin = {file = file, declaration = #state[category] + 1, includeChain = table.clone(state.chain)}
        if copy.provider then
            copy.provider = table.clone(copy.provider)
            if not check(type(copy.provider.module) == "string", file .. ": provider.module is required") then return end
            copy.provider.module = path.absolute(copy.provider.module, path.directory(file))
            if copy.provider.inputs then
                if not check(type(copy.provider.inputs) == "table", file .. ": provider.inputs must be a list of file patterns") then return end
                copy.provider.inputs = table.clone(copy.provider.inputs)
                for index, pattern in ipairs(copy.provider.inputs) do
                    if not check(type(pattern) == "string" and #pattern > 0, file .. ": invalid provider.inputs pattern") then return end
                    copy.provider.inputs[index] = path.absolute(pattern, path.directory(file))
                end
            end
        end
        table.insert(state[category], copy)
    end
    local api = {_cautest_root = toolroot, _fail = fail, _samePass = function () return interp:scriptfiles() == generation end}
    api.project = function (input)
        local file = source()
        if not fields(input, {"defaults", "profiles"}, file .. ": ctest.project") then return end
        if not check(not state.projectSource, "ctest.project may only be declared once") then return end
        state.projectSource = file
        state.project = table.clone(input)
        if state.project.defaults then
            state.project.defaults = table.clone(state.project.defaults)
            for _, key in ipairs({"resultDir", "cacheDir", "workDir", "generatedDir"}) do
                if state.project.defaults[key] then state.project.defaults[key] = path.absolute(state.project.defaults[key], path.directory(file)) end
            end
        end
    end
    api.include = function (input)
        local caller = source()
        if not fields(input, {"patterns", "optional"}, caller .. ": ctest.include") then return end
        if not check(type(input.patterns) == "table" and #input.patterns > 0, caller .. ": include.patterns must be nonempty") then return end
        if not check(input.optional == nil or type(input.optional) == "boolean", caller .. ": include.optional must be boolean") then return end
        local files, seen = {}, {}
        for _, pattern in ipairs(input.patterns) do
            if not check(type(pattern) == "string" and #pattern > 0, caller .. ": invalid include pattern") then return end
            local matches = os.files(path.absolute(pattern, path.directory(caller)))
            if not check(#matches > 0 or input.optional == true, caller .. ": required pattern matched no files: " .. pattern) then return end
            for _, file in ipairs(matches) do
                file = path.absolute(file)
                if not seen[file] then table.insert(files, file); seen[file] = true end
            end
        end
        table.sort(files)
        local root = #state.chain == 0
        if root then table.insert(state.chain, caller); state.active[caller] = true end
        for _, file in ipairs(files) do
            if not check(not state.active[file], "ctest.include cycle: " .. table.concat(state.chain, " -> ") .. " -> " .. file) then return end
            if not state.visited[file] then
                state.active[file] = true
                table.insert(state.chain, file)
                interp:api_builtin_includes(file)
                table.remove(state.chain)
                state.active[file] = nil
                state.visited[file] = true
                state.sources[file] = true
            end
        end
        if root then table.remove(state.chain); state.active[caller] = nil end
    end
    for _, name in ipairs({"native", "mcu", "kernel", "driver", "workflow", "board", "environment"}) do
        local kind = name
        api[kind] = function (input) declaration(kind, input) end
    end
    interp:api_register_builtin("ctest", api)
    local existing = interp:make("task", false, false)
    if not check(not existing or (not existing.ct and not existing["cautest-artifact"]), "ct/cautest-artifact task name is reserved by Cautest") then return end
    local original_task = previous_task or interp:api_func("task")
    api._originalTask = original_task
    interp:api_register(nil, "task", function (_, name, ...)
        if not check(not state.sealed or (name ~= "ct" and name ~= "cautest-artifact"), "ct/cautest-artifact task name is reserved by Cautest") then return end
        return original_task(name, ...)
    end)
end}}})
cautest_initialize()

includes("rules/native.lua")

task("ct")
    set_category("plugin")
    on_run(function ()
        import("main", {rootdir = moduledir}).run(state, toolroot)
    end)
    set_menu {
        usage = "xmake ct [options] [Job IDs ...]",
        description = "Run Cautest workflows declared with ctest.* (default: all enabled jobs).",
        options = {
            {nil, "list", "k", nil, "List jobs without building or deploying."},
            {nil, "plan", "k", nil, "Show workflows without executing steps."},
            {nil, "doctor", "k", nil, "Check static requirements."},
            {nil, "describe", "k", nil, "Show sources and configuration hash."},
            {nil, "json", "k", nil, "Machine-readable stdout."},
            {nil, "level", "kv", nil, "Comma-separated levels (OR); repeated options are last-wins."},
            {nil, "tag", "kv", nil, "Comma-separated required tags (AND)."},
            {nil, "suite", "kv", nil, "Comma-separated runtime suite patterns."},
            {nil, "case", "kv", nil, "Comma-separated runtime case patterns."},
            {nil, "parameter", "kv", nil, "Comma-separated parameter patterns."},
            {nil, "include", "kv", nil, "Comma-separated C case include patterns."},
            {nil, "exclude", "kv", nil, "Comma-separated C case exclude patterns."},
            {nil, "test-profile", "kv", nil, "Cautest profile (Xmake --profile is unchanged)."},
            {nil, "reporter", "kv", nil, "console,json,junit,html"},
            {nil, "output-dir", "kv", nil, "Result directory, relative to project root."},
            {nil, "case-timeout", "kv", nil, "Per-case timeout in milliseconds."},
            {nil, "run-timeout", "kv", nil, "C Test run timeout in milliseconds."},
            {nil, "suite-policy", "kv", nil, "CONTINUE/STOP_ON_FAIL/STOP_ON_ERROR"},
            {nil, "fail-fast", "k", nil, "Stop after the first failing job."},
            {nil, "node", "kv", nil, "Explicit Node executable; no automatic installation."},
            {nil, "jobs", "vs", nil, "Job ID glob patterns (OR)."}
        }
    }
task_end()

task("cautest-artifact")
    set_category("plugin")
    on_run(function ()
        import("main", {rootdir = moduledir}).artifact(state, toolroot)
    end)
    set_menu {usage = "xmake cautest-artifact --target=NAME --output-file=PATH", description = "Internal read-only artifact query; does not compile.", options = {
        {nil, "target", "kv", nil, "Target name."},
        {nil, "output-file", "kv", nil, "Atomic JSON receipt description destination."}
    }}
task_end()
state.sealed = true
