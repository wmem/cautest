import("core.base.json")
import("core.project.config")
function main(_target, here)
    local kernel = config.get("kernel_build")
    assert(kernel and os.isdir(kernel), "Configure --kernel_build=<prepared Kernel build/headers>; no implicit running Kernel")
    kernel = path.absolute(kernel, os.projectdir())
    local identity = {schemaVersion=1, arch="x86_64", kernelBuild=kernel, inputs={}}
    for _, name in ipairs({".config", "Module.symvers", "include/config/kernel.release"}) do
        local file = path.join(kernel,name)
        assert(os.isfile(file), "Required Kernel identity input missing: " .. file)
        identity.inputs[name] = hash.sha256(file):lower()
    end
    local configuration = io.readfile(path.join(kernel,".config"))
    assert(configuration:find("CONFIG_X86_64=y",1,true), "This example only accepts a prepared x86_64 Kernel; UML uses a separate Environment")
    identity.release = io.readfile(path.join(kernel,"include/config/kernel.release")):trim()
    local output = path.join(os.projectdir(),"build/driver")
    local staging = path.join(os.projectdir(),"build", ".driver-" .. hash.uuid())
    -- Product owns its original Kbuild, source and macro facts; JS does not rebuild it.
    os.mkdir(staging)
    local err
    local ok = try {function ()
        os.cp(path.join(here,"driver/Makefile"),path.join(staging,"Makefile"))
        os.cp(path.join(here,"driver/cautest_demo.c"),path.join(staging,"cautest_demo.c"))
        os.vrunv("make", {"-C",kernel,"M=" .. staging,"ARCH=x86_64","CAUTEST_DEMO_VALUE=" .. tostring(config.get("demo_value") or "7"),"-j2","modules"})
        for _, name in ipairs({".config", "Module.symvers", "include/config/kernel.release"}) do
            assert(hash.sha256(path.join(kernel,name)):lower()==identity.inputs[name], "Kernel identity changed during Kbuild")
        end
        io.writefile(path.join(staging,"kernel-identity.json"),json.encode(identity))
        os.mkdir(output)
        for _, name in ipairs({"cautest_demo.ko","Module.symvers","modules.order","kernel-identity.json"}) do os.cp(path.join(staging,name),path.join(output,name)) end
        return true
    end, catch {function (errors) err=errors; return false end}, finally {function () os.rm(staging) end}}
    assert(ok, err)
end
