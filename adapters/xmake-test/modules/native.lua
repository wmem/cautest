import("core.base.bytes")
import("core.base.json")
import("core.project.config")
local runtime_sources = {"core/cautest.c", "protocol/ctp3.c", "platform/posix/cautest_posix_platform.c", "target/posix/cautest_posix_target.c"}
function configure_coverage(target)
    assert(target:plat() == "linux", "cautest.gcov currently requires Linux GCC and matching gcov")
    target:values_set("cautest.gcov", true)
    -- Xmake 的编译缓存只恢复 .o，既不恢复 gcno，也不重写对象内的 gcda 路径。
    target:set("policy", "build.ccache", false)
    target:add("cxflags", "--coverage", "-fprofile-abs-path", {force = true})
    target:add("ldflags", "--coverage", {force = true})
    target:add("defines", "CAUTEST_GCOV=1")
end

-- gcno 是编译副产物；缺失时移除对应对象，让 Xmake 正常重编译。
function prepare_coverage(target)
    for _, batch in pairs(target:sourcebatches()) do
        if batch.sourcekind == "cc" or batch.sourcekind == "cxx" then
            for _, object in ipairs(batch.objectfiles or {}) do
                if os.isfile(object) and not os.isfile(object:gsub("%.[^%.]+$", ".gcno")) then
                    os.rm(object)
                end
            end
        end
    end
end

-- 只声明本次目标及已显式插桩依赖的真实输出，不扫描整个 build 目录。
function coverage_notes(target)
    if not target:values("cautest.gcov") then return {} end
    local files, seen = {}, {}
    local components = table.join({target}, target:orderdeps() or {})
    for _, component in ipairs(components) do
        if component:values("cautest.gcov") then
            for _, batch in pairs(component:sourcebatches()) do
                if batch.sourcekind == "cc" or batch.sourcekind == "cxx" then
                    for _, object in ipairs(batch.objectfiles or {}) do
                        local note = path.absolute(object:gsub("%.[^%.]+$", ".gcno"), os.projectdir())
                        if not seen[note] then table.insert(files, note); seen[note] = true end
                    end
                end
            end
        end
    end
    table.sort(files)
    return files
end
function write_changed(file, contents)
    if os.isfile(file) and io.readfile(file) == contents then return end
    os.mkdir(path.directory(file))
    local temporary = file .. "." .. hash.uuid() .. ".tmp"
    io.writefile(temporary, contents)
    os.mv(temporary, file)
end
function directory(target)
    return target:data("cautest.generated_directory")
        or path.absolute(path.join(target:autogendir(), "cautest"), os.projectdir())
end
function generate(target, toolroot)
    local simulated = target:data("cautest.simulated") == true
    local mcu = target:data("cautest.mcu") == true
    local suites = table.wrap(target:values("cautest.registry.suites"))
    assert(#suites > 0, target:name() .. ": cautest.registry.suites must contain explicit C symbols")
    local seen = {}
    for _, suite in ipairs(suites) do
        assert(type(suite) == "string" and suite:match("^[A-Za-z_][A-Za-z0-9_]*$") and not seen[suite], "Invalid/duplicate C Suite symbol: " .. tostring(suite))
        seen[suite] = true
    end
    local dir = directory(target)
    local workspace = target:values("cautest.workspaceSize") or (mcu and 2048 or 65536)
    local timeout = target:values("cautest.caseTimeoutMs") or 1000
    assert(type(workspace)=="number" and workspace>0 and workspace==math.floor(workspace), "cautest.workspaceSize must be a positive integer")
    assert(type(timeout)=="number" and timeout>0 and timeout==math.floor(timeout), "cautest.caseTimeoutMs must be a positive integer")
    -- 协议身份独立于源码内容；构建依赖由宿主构建系统管理。
    local identity = path.join(dir, "identity.json")
    local id
    if os.isfile(identity) then id = json.decode(io.readfile(identity)).protocolBuildId end
    if not id then
        id = hash.uuid():gsub("-", ""):lower():sub(1, 24)
        write_changed(identity, json.encode({protocolBuildId = id}))
    end
    target:data_set("cautest.protocolBuildId", id)
    if simulated then target:add("defines", 'CAUTEST_MCU_BUILD_ID="' .. id .. '"') end
    local registry = {"#include <cautest/cautest.h>\n"}
    for _, suite in ipairs(suites) do table.insert(registry,"CAUTEST_SUITE_DECLARE(" .. suite .. ");\n") end
    table.insert(registry,"\nCAUTEST_REGISTRY(" .. ((simulated or mcu) and "cautest_mcu_registry" or "cautest_generated_registry") .. ",\n")
    local references = {}
    for _, suite in ipairs(suites) do table.insert(references,"    CAUTEST_SUITE_REF(" .. suite .. ")") end
    table.insert(registry,table.concat(references,",\n") .. ");\n")
    write_changed(path.join(dir,"registry.c"),table.concat(registry))
    if mcu then
        write_changed(path.join(dir,"cautest_config.h"),string.format('#ifndef CAUTEST_GENERATED_CONFIG_H\n#define CAUTEST_GENERATED_CONFIG_H\n#define CAUTEST_MCU_BUILD_ID "%s"\n#define CAUTEST_MCU_WORKSPACE_SIZE %d\n#endif\n',id,workspace))
    elseif not simulated then write_changed(path.join(dir,"entry.c"),string.format('#include "posix_target.h"\nextern const struct cautest_registry cautest_generated_registry;\nint main(void) {\n  const struct cautest_posix_target_config config = {"%s", %dUL, %dUL};\n  return cautest_posix_target_main(&cautest_generated_registry, &config);\n}\n',id,workspace,timeout)) end
end
function configure(target, toolroot, simulated, guest)
    target:data_set("cautest.simulated", simulated == true)
    target:data_set("cautest.driver_guest", guest == true)
    assert(target:kind()=="binary", "cautest.native requires an explicit binary target, not automatic target cloning")
    assert(os.host()=="linux" and os.arch()=="x86_64" and target:plat()=="linux" and target:arch()=="x86_64", "cautest.native currently supports Linux x86_64 host targets only; cross-config targets must use another provider")
    local identity = path.join(directory(target),"identity.json")
    if os.isfile(identity) then target:data_set("cautest.protocolBuildId",json.decode(io.readfile(identity)).protocolBuildId) end
    local kit = path.join(toolroot,"assets/cautest-c")
    local sources = simulated and {"core/cautest.c", "protocol/ctp3.c", "platform/freestanding/cautest_freestanding.c", "target/mcu-reference/mcu_reference.c", "target/mcu-reference/mcu_sim_target.c"} or runtime_sources
    if guest then
        sources = table.join(sources, {"agent/uml-guest-agent/probe_client.c"})
        target:add("includedirs",path.join(kit,"agent/uml-guest-agent"),path.join(kit,"platform/linux-kernel/include"))
        target:add("ldflags","-static",{force=true})
    end
    for _, source in ipairs(sources) do target:add("files",path.join(kit,source)) end
    local includes = simulated and {"include","platform/freestanding","target/mcu-reference"} or {"include","platform/posix","target/posix"}
    for _, include in ipairs(includes) do target:add("includedirs",path.join(kit,include)) end
    target:add("files",path.join(directory(target),"registry.c"),{always_added=true})
    if simulated then target:add("cflags","-ffreestanding","-fno-builtin")
    else target:add("files",path.join(directory(target),"entry.c"),{always_added=true}) end
end
