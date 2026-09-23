import("core.base.bytes")
import("core.base.json")
import("core.project.config")
local runtime_sources = {"core/cautest.c", "protocol/ctp3.c", "platform/posix/cautest_posix_platform.c", "target/posix/cautest_posix_target.c"}
function write_changed(file, contents)
    if os.isfile(file) and io.readfile(file) == contents then return end
    os.mkdir(path.directory(file))
    local temporary = file .. "." .. hash.uuid() .. ".tmp"
    io.writefile(temporary, contents)
    os.mv(temporary, file)
end
function directory(target)
    return path.absolute(path.join(target:autogendir(), "cautest"), os.projectdir())
end
function generate(target, toolroot)
    local suites = table.wrap(target:values("cautest.registry.suites"))
    assert(#suites > 0, target:name() .. ": cautest.registry.suites must contain explicit C symbols")
    local seen = {}
    for _, suite in ipairs(suites) do
        assert(type(suite) == "string" and suite:match("^[A-Za-z_][A-Za-z0-9_]*$") and not seen[suite], "Invalid/duplicate C Suite symbol: " .. tostring(suite))
        seen[suite] = true
    end
    local dir = directory(target)
    local files, found = {}, {}
    local function add(file)
        file = path.absolute(file, os.projectdir())
        if file ~= path.join(dir,"entry.c") and file ~= path.join(dir,"registry.c") and os.isfile(file) and not found[file] then
            found[file] = true; table.insert(files,file)
        end
    end
    local function inputs(component)
        for _, file in ipairs(component:sourcefiles()) do add(file) end
        for _, include in ipairs(table.wrap(component:get("includedirs"))) do
            for _, file in ipairs(os.files(path.join(path.absolute(include,os.projectdir()), "**.h"))) do add(file) end
        end
    end
    inputs(target)
    for _, dependency in ipairs(target:orderdeps() or {}) do inputs(dependency) end
    add(path.join(toolroot,"adapters/xmake-test/modules/native.lua"))
    add(path.join(toolroot,"adapters/xmake-test/rules/native.lua"))
    add(path.join(toolroot,"versions.json"))
    table.sort(files)
    local workspace = target:values("cautest.workspaceSize") or 65536
    local timeout = target:values("cautest.caseTimeoutMs") or 1000
    assert(type(workspace)=="number" and workspace>0 and workspace==math.floor(workspace), "cautest.workspaceSize must be a positive integer")
    assert(type(timeout)=="number" and timeout>0 and timeout==math.floor(timeout), "cautest.caseTimeoutMs must be a positive integer")
    -- Stable input identity is distinct from the SHA-256 of the final linked output.
    local parts = {"cautest-native-v1", target:name(), config.get("plat") or os.host(), config.get("arch") or os.arch(), config.get("mode") or "release", table.concat(suites,","), tostring(workspace), tostring(timeout)}
    for _, key in ipairs({"defines","undefines","cxflags","cflags","ldflags","links","languages","includedirs","toolchains"}) do
        table.insert(parts, key .. "=" .. json.encode(target:get(key) or {}))
    end
    for _, dependency in ipairs(target:orderdeps() or {}) do
        table.insert(parts,"dependency=" .. dependency:name())
        for _, key in ipairs({"defines","undefines","cxflags","cflags","ldflags","links","languages","includedirs","toolchains"}) do
            table.insert(parts,key .. "=" .. json.encode(dependency:get(key) or {}))
        end
    end
    if os.isfile(config.filepath()) then table.insert(parts,hash.sha256(config.filepath())) end
    for _, file in ipairs(files) do table.insert(parts,file);table.insert(parts,hash.sha256(file)) end
    local id = hash.sha256(bytes(table.concat(parts,"\0"))):lower()
    target:data_set("cautest.protocolBuildId",id)
    -- Content-sensitive command line also invalidates Xmake's timestamp cache
    -- when two generated/source updates occur in the same filesystem second.
    target:add("defines", 'CAUTEST_INPUT_ID="' .. id .. '"')
    -- Force the linker dependency key as well: same-second object updates
    -- otherwise let timestamp-based incremental linking retain an old binary.
    target:add("ldflags", "-Wl,--build-id=0x" .. id, {force=true})
    write_changed(path.join(dir,"identity.json"), json.encode({protocolBuildId=id}))
    local registry = {"#include <cautest/cautest.h>\n"}
    for _, suite in ipairs(suites) do table.insert(registry,"CAUTEST_SUITE_DECLARE(" .. suite .. ");\n") end
    table.insert(registry,"\nCAUTEST_REGISTRY(cautest_generated_registry,\n")
    local references = {}
    for _, suite in ipairs(suites) do table.insert(references,"    CAUTEST_SUITE_REF(" .. suite .. ")") end
    table.insert(registry,table.concat(references,",\n") .. ");\n")
    write_changed(path.join(dir,"registry.c"),table.concat(registry))
    write_changed(path.join(dir,"entry.c"),string.format('#include "posix_target.h"\nextern const struct cautest_registry cautest_generated_registry;\nint main(void) {\n  const struct cautest_posix_target_config config = {"%s", %dUL, %dUL};\n  return cautest_posix_target_main(&cautest_generated_registry, &config);\n}\n',id,workspace,timeout))
end
function configure(target, toolroot)
    assert(target:kind()=="binary", "cautest.native requires an explicit binary target, not automatic target cloning")
    assert(os.host()=="linux" and os.arch()=="x86_64" and target:plat()=="linux" and target:arch()=="x86_64", "cautest.native currently supports Linux x86_64 host targets only; cross-config targets must use another provider")
    local identity = path.join(directory(target),"identity.json")
    if os.isfile(identity) then target:data_set("cautest.protocolBuildId",json.decode(io.readfile(identity)).protocolBuildId) end
    local kit = path.join(toolroot,"assets/cautest-c")
    for _, source in ipairs(runtime_sources) do target:add("files",path.join(kit,source)) end
    for _, include in ipairs({"include","platform/posix","target/posix"}) do target:add("includedirs",path.join(kit,include)) end
    target:add("files",path.join(directory(target),"registry.c"),{always_added=true})
    target:add("files",path.join(directory(target),"entry.c"),{always_added=true})
end
