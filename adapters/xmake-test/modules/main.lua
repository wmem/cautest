import("core.base.option")
import("core.base.json")
import("core.project.project")
import("core.project.config")
import("lib.detect.find_tool")
import("context")

function atomic(file, data, directoryReady)
    if not directoryReady then os.mkdir(path.directory(file)) end
    local temporary = file .. "." .. hash.uuid() .. ".tmp"
    io.writefile(temporary, json.encode(data))
    os.mv(temporary, file)
end

function arrays(state)
    for _, name in ipairs({"jobs", "boards", "environments"}) do
        json.mark_as_array(state[name])
        for _, item in ipairs(state[name]) do
            json.mark_as_array(item.origin.includeChain)
            for _, key in ipairs({"tags", "drivers"}) do if item[key] then json.mark_as_array(item[key]) end end
            if item.run then
                for _, key in ipairs({"suite", "case", "parameter", "include", "exclude"}) do
                    if type(item.run[key]) == "table" then json.mark_as_array(item.run[key]) end
                end
            end
        end
    end
    if state.project.profiles then json.mark_as_array(state.project.profiles) end
    if state.project.collectors then
        json.mark_as_array(state.project.collectors)
        for _, collector in ipairs(state.project.collectors) do
            json.mark_as_array(collector.origin.includeChain)
            if collector.provider.inputs then json.mark_as_array(collector.provider.inputs) end
        end
    end
end

function run(state, toolroot)
    config.load()
    local selected = option.get("config")
    if selected then
        selected = path.absolute(selected, os.projectdir())
        if not os.isfile(selected) then
            io.stderr:write("Cautest configuration not found: " .. selected .. "\n")
            os.exit(3)
        end
        os.setenv("CAUTEST_XMAKE_CONFIG", selected)
    end
    state.reload(project.rootfile(), project.rcfiles())
    if not state.configLoaded and #state.jobs == 0 and #state.errors == 0 then
        table.insert(state.errors, "Cautest configuration not found: " .. state.configPath .. "; create ctest.lua or use --config=FILE")
    end
    if #state.errors > 0 then
        io.stderr:write(table.concat(state.errors, "\n") .. "\n")
        os.exit(3)
    end
    local count, command = 0, "run"
    for _, candidate in ipairs({"list", "plan", "doctor", "describe"}) do
        if option.get(candidate) then count = count + 1; command = candidate end
    end
    assert(count <= 1, "--list/--plan/--doctor/--describe are mutually exclusive")
    local node = option.get("node") or os.getenv("CAUTEST_NODE")
    if not node then local found = find_tool("node"); node = found and found.program end
    assert(node, "Cautest requires Node >=20.6. Set CAUTEST_NODE or --node; no network installation is attempted.")
    local bridge = path.join(toolroot, "adapters/xmake-test/entry.mjs")
    assert(os.isfile(path.join(toolroot, "dist/adapters/xmake/entry.js")) or os.isfile(path.join(toolroot, "lib/adapters/xmake/entry.js")),
        "Cautest checkout is not built. Run npm ci in " .. toolroot .. " (or npm run prepare with installed dependencies).")
    arrays(state)
    local sources = table.keys(state.sources)
    -- Includes of product build definitions also contribute to the execution identity.
    for _, file in ipairs(project.allfiles() or {}) do table.insert(sources, path.absolute(file, os.projectdir())) end
    for _, script in ipairs(os.files(path.join(toolroot, "adapters/xmake-test/**"))) do table.insert(sources, script) end
    table.insert(sources, path.join(toolroot, "versions.json"))
    sources = table.unique(sources); table.sort(sources); json.mark_as_array(sources)
    local versions = json.decode(io.readfile(path.join(toolroot, "versions.json")))
    local manifest = {schemaVersion = versions.schemas.xmakeManifest, kind = "cautest.xmake-manifest", projectRoot = path.absolute(os.projectdir()),
        xmake = os.programfile(), buildContext = context.get(), project = state.project,
        jobs = state.jobs, boards = state.boards, environments = state.environments, sources = sources}
    local file = path.join(os.projectdir(), ".cautest/xmake/manifests", hash.uuid() .. ".json")
    -- Xmake 3.1.1 os.mkdir may race when several ct processes create this path at once.
    local directory = path.directory(file)
    local directoryCode = os.execv(node, {"-e", "require('node:fs').mkdirSync(process.argv[1], {recursive: true})", directory}, {try = true})
    assert(directoryCode == 0, "Cannot create Xmake manifest directory: " .. directory)
    atomic(file, manifest, true)
    local args = {bridge, "--manifest", file, command}
    for _, key in ipairs({"level", "tag", "suite", "case", "parameter", "include", "exclude"}) do
        local value = option.get(key)
        if value then
            for _, item in ipairs(value:split(",", {plain = true, strict = true})) do
                item = item:trim(); assert(#item > 0, "empty value in --" .. key)
                table.insert(args, "--" .. key); table.insert(args, item)
            end
        end
    end
    for _, key in ipairs({"reporter", "output-dir", "case-timeout", "run-timeout", "suite-policy"}) do
        if option.get(key) then table.insert(args, "--" .. key); table.insert(args, option.get(key)) end
    end
    if option.get("test-profile") then table.insert(args, "--profile"); table.insert(args, option.get("test-profile")) end
    for _, key in ipairs({"json", "fail-fast", "verbose"}) do if option.get(key) then table.insert(args, "--" .. key) end end
    table.join2(args, option.get("jobs") or {})
    local envs = {CAUTEST_XMAKE_WORKINGDIR = os.workingdir()}
    if state.configLoaded then envs.CAUTEST_XMAKE_CONFIG = state.configPath end
    local code = os.execv(node, args, {curdir = os.projectdir(), envs = envs, try = true})
    os.exit(code or 2)
end

function artifact(_state, _toolroot)
    assert(option.get("target") and option.get("output-file"), "--target and --output-file are required")
    config.load()
    project.load_targets()
    local target = project.target(option.get("target"))
    assert(target, "Unknown Xmake target: " .. option.get("target"))
    local outputs = {}
    local primary = target:targetfile()
    if primary and target:kind() ~= "phony" then table.insert(outputs, {role = "primary", path = path.absolute(primary, os.projectdir())}) end
    for index, note in ipairs(import("native").coverage_notes(target)) do
        table.insert(outputs, {role = "gcov-note-" .. tostring(index), path = note})
    end
    for _, spec in ipairs(table.wrap(target:values("cautest.outputs"))) do
        assert(type(spec) == "string", "cautest.outputs entries must be role=path strings")
        local role, file = spec:match("^([^=]+)=(.+)$")
        assert(role and file, "cautest.outputs entries must be role=path strings")
        table.insert(outputs, {role = role, path = path.absolute(file, target:scriptdir())})
    end
    assert(#outputs > 0, "Target has no outputs; declare add_values(\"cautest.outputs\", \"role=path\")")
    local protocol = target:data("cautest.protocolBuildId") or target:values("cautest.protocolBuildId")
    local result = {schemaVersion = 1, kind = "cautest.artifact-description", target = target:name(), context = context.get(),
        outputs = json.mark_as_array(outputs), protocolBuildId = protocol}
    atomic(path.absolute(option.get("output-file"), os.projectdir()), result)
end
