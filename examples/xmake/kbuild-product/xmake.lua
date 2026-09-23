set_project("cautest-kbuild-product-contract")
includes("tools/cautest/xmake.lua")
option("kernel_build")
    set_showmenu(true)
    set_description("Prepared Kernel build/headers directory; never uses the running Kernel implicitly")
option_end()
option("demo_value")
    set_default("7")
    set_showmenu(true)
option_end()
local here = os.scriptdir()
target("product.driver")
    set_kind("phony")
    set_default(false)
    add_values("cautest.outputs", "ko=build/driver/cautest_demo.ko", "symbols=build/driver/Module.symvers", "order=build/driver/modules.order", "kernel-identity=build/driver/kernel-identity.json")
    on_build(function (target)
        import("product_build", {rootdir = here}).main(target, here)
    end)
target_end()
ctest.workflow {
    id = "integration.kbuild-contract",
    provider = {module = "contract.mjs", export = "create"},
    artifacts = {module = {target="product.driver", output="ko"}, symbols = {target="product.driver",output="symbols"}, identity = {target="product.driver",output="kernel-identity"}}
}
