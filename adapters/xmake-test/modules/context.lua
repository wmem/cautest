import("core.project.config")
function get()
    config.load()
    local root = path.absolute(os.projectdir())
    local result = {
        projectRoot = root,
        plat = config.get("plat") or os.host(),
        arch = config.get("arch") or os.arch(),
        mode = config.get("mode") or "release",
        buildDir = path.absolute(config.builddir() or "build", root)
    }
    local file = config.filepath()
    if os.isfile(file) then result.configDigest = hash.sha256(file):lower() end
    return result
end
