-- JS 构建由工具包负责，宿主工程只需声明源码依赖。
function on_install(ctx)
    os.execv("npm", {"ci", "--ignore-scripts"}, {curdir = ctx.rootdir})
    os.execv("npm", {"run", "build"}, {curdir = ctx.rootdir})
end
