local root = path.absolute("../..",os.scriptdir())
target("product.driver")
    set_kind("phony")
    set_default(false)
    add_values("cautest.outputs", "ko=../../build/modules/cautest_echo/cautest_echo.ko", "symbols=../../build/modules/cautest_echo/Module.symvers", "order=../../build/modules/cautest_echo/modules.order", "kernel-context=../../build/modules/cautest_echo/kernel-context.json")
    on_build(function (target)
        import("product_build", {rootdir = root}).main(target, root, "driver", "cautest_echo")
    end)
target_end()
target("test.driver-guest")
    set_kind("binary")
    set_default(false)
    add_rules("cautest.driver-guest")
    add_files("../guest/driver_test.c")
    add_includedirs("../include")
    add_values("cautest.registry.suites", "driver_abi")
target_end()
ctest.driver {
    id="integration.driver.abi", environment="uml", tags={"driver","uml"},
    drivers={{target="product.driver",output="ko"}}, guest={target="test.driver-guest"}, buildTimeoutMs=300000
}
