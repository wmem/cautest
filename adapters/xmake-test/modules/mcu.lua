import("native")
import("core.base.json")

-- 只提供公共 C 运行时和 Registry；工具链、RTOS、驱动及入口由工程配置。
function configure(target, toolroot)
    assert(target:kind() == "binary", "cautest.mcu 必须用于显式 binary 固件 target")
    target:data_set("cautest.mcu", true)
    local generated = native.directory(target)
    -- 其他规则可能随后设置交叉工具链；生成和编译必须使用同一个目录。
    target:data_set("cautest.generated_directory", generated)
    local identity = path.join(generated, "identity.json")
    if os.isfile(identity) then
        target:data_set("cautest.protocolBuildId", json.decode(io.readfile(identity)).protocolBuildId)
    end
    local kit = path.join(toolroot, "assets/cautest-c")
    target:add("includedirs", path.join(kit, "include"), generated)
    for _, source in ipairs({ "core/cautest.c", "protocol/ctp3.c", "target/mcu/mcu.c" }) do
        target:add("files", path.join(kit, source))
    end
    target:add("files", path.join(generated, "registry.c"), { always_added = true })
end

function generate(target, toolroot)
    native.generate(target, toolroot)
end
