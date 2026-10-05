import("core.base.json")
-- The product Makefile remains the source of module sources, flags, and dependencies.
-- Cautest only passes the prepared Environment. Never guess the running host Kernel.
function main(target, root, directory, module)
    local kernel = os.getenv("CAUTEST_KERNEL_BUILD")
    local context_file = os.getenv("CAUTEST_KERNEL_CONTEXT")
    assert(kernel and context_file, "This test target needs the shared UML Environment; invoke xmake ct")
    local context = json.decode(io.readfile(context_file))
    assert(context.kind == "cautest.kernel-context" and context.schemaVersion == 2 and (context.arch == "um" or context.arch == "x86_64"), "Invalid explicit Kernel context")
    local files = {path.join(kernel, ".config"), path.join(kernel, "Module.symvers"), context.imagePath}
    local states = {}
    for _, file in ipairs(files) do
        assert(os.isfile(file), "Missing Kernel input: " .. file)
        states[file] = {size = os.filesize(file), mtime = os.mtime(file)}
    end
    local function verify()
        assert(path.absolute(kernel) == context.outputDir, "Kernel build path mismatch")
        for file, state in pairs(states) do
            assert(os.isfile(file) and os.filesize(file) == state.size and os.mtime(file) == state.mtime,
                   "Kernel metadata changed during module build: " .. file)
        end
        assert(io.readfile(path.join(kernel, "include/config/kernel.release")):trim() == context.release, "Kernel release changed")
    end
    verify()
    local config = io.readfile(path.join(kernel,".config"))
    if context.arch == "um" then assert(config:find("CONFIG_UML=y",1,true), "Expected a UML Kernel")
    else assert(config:find("CONFIG_X86_64=y",1,true) and not config:find("CONFIG_UML=y",1,true), "Expected x86_64 host Kernel headers") end
    local output = path.join(os.projectdir(), "build/modules", module)
    local staging = path.join(os.projectdir(), "build", ".module-" .. hash.uuid())
    assert(not staging:find("%s") and not kernel:find("%s"), "Kbuild requires whitespace-free build paths; configure an isolated checkout/build directory")
    local kit = path.join(root,"tools/cautest/assets/cautest-c")
    os.mkdir(staging)
    local failure
    local ok = try {function ()
        os.cp(path.join(root,"product"),path.join(staging,"product"))
        local source = path.join(staging,"product",directory)
        local args = {"-C",kernel,"M=" .. source,"ARCH=" .. context.arch,"CAUTEST_C_ROOT=" .. kit,"-j4","modules"}
        if context.crossCompile ~= "" then table.insert(args,"CROSS_COMPILE=" .. context.crossCompile) end
        local symbols = os.getenv("CAUTEST_EXTRA_SYMBOLS")
        if symbols and symbols ~= "" then table.insert(args,"KBUILD_EXTRA_SYMBOLS=" .. symbols) end
        os.vrunv("make",args)
        verify()
        os.mkdir(output)
        for _, file in ipairs({module .. ".ko","Module.symvers","modules.order"}) do os.cp(path.join(source,file),path.join(output,file)) end
        -- Attest exactly the context used above, not a new unrelated host identity.
        io.writefile(path.join(output,"kernel-context.json"),json.encode(context))
        return true
    end, catch {function (err) failure=err; return false end}, finally {function () os.rm(staging) end}}
    assert(ok, failure)
end
