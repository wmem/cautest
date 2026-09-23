# API 草案与工程示例

本文件用于固定用户体验和编写后续验收 fixture。**`ctest.*`、`cautest.native` rule、产物角色与资源声明均待实现；不能把本文件直接复制到旧 Cautest 0.2.1 就运行。** 标准 Xmake 语句与拟新增 API 一起展示，具体接入先经过 PLAN 的 P0 验证。

## 1. 根 xmake.lua

```lua
set_project("my-project")

includes("tools/cautest/xmake.lua")
includes("src/xmake.lua")
includes("drivers/xmake.lua")
includes("ctest.lua")
```

工具入口只注册能力。产品定义和测试定义都使用 Xmake 的构建模型，具体文件路径依工程布局调整。

## 2. 根 ctest.lua

```lua
ctest.project {
    defaults = {
        resultDir = ".cautest/results",
        jobTimeoutMs = 120000
    },
    profiles = {
        {
            id = "ci",
            reporters = {"json", "junit"}
        }
    }
}

ctest.include {
    patterns = {"tests/support/resources.lua"}
}

ctest.include {
    patterns = {
        "src/**/test/test.lua",
        "drivers/**/test/test.lua",
        "tests/**/test.lua"
    }
}
```

以上示例假设这些测试根真实存在。没有 MCU/Driver 的工程应删去相应必需 Pattern，或对确实可选的定义集合使用 `optional = true`，而不是让所有 Pattern 都静默忽略错误。

一个可选测试模块的写法：

```lua
ctest.include {
    patterns = {"optional-module/test/test.lua"},
    optional = true
}
```

根文件不包含逐条 Case 清单。子目录新增 test.lua 可被收集；增加 C Case 通常不改 Job；新增 C Suite 仍需加入对应 Registry。

## 3. 共享产品源码定义，不克隆产品 target

下面是拟采用的 Xmake 共享配置模式。它不是 Adapter 的第二份构建 Schema。

```lua
-- src/math/xmake.lua
-- 捕获定义所在目录，避免函数从测试目录调用时路径漂移。
local math_dir = os.scriptdir()

function use_math_sources()
    add_files(path.join(math_dir, "*.c"))
    add_includedirs(path.join(math_dir, "include"))
end
```

工程级产品配置也可以集中在一个标准 Xmake 函数/rule 中：

```lua
function use_product_config()
    add_defines("MATH_WORD_BITS=32", "CONFIG_CHECK_BOUNDS=1")
end
```

产品使用该定义：

```lua
target("app")
    set_kind("binary")
    use_product_config()
    use_math_sources()
    add_files("app/main.c")
target_end()
```

测试 target 使用同一份定义，不再维护产品源码和宏的第二份列表。私有编译宏确实需要随最终 target 变化时，源码在目标中重编；已经编译好的共享库不能被消费者宏反向改变。

P0 必须验证上述函数在目标 Xmake 版本中的导出、作用域、路径基准和条件配置行为；对有复杂 hook、包依赖或工具链的组件，要用对应测试证明共享契约，而不是推断所有 target 都能这么处理。

## 4. Native 局部 test.lua

```lua
-- src/math/test/test.lua
-- 标准 Xmake target 定义，可与 Job 声明放在同一局部文件。
target("test.math")
    set_kind("binary")
    set_default(false)

    use_product_config()
    use_math_sources()
    add_files("*_test.c")

    -- 以下为适配层拟新增的 Runtime/Registry 规则与元数据。
    add_rules("cautest.native")
    add_values("cautest.registry.suites",
        "math_arithmetic",
        "math_limits")
target_end()

ctest.native {
    id = "unit.math",
    target = "test.math",
    level = "unit",
    tags = {"native", "math", "fast"},
    run = {
        suite = {"math_*"}
    }
}
```

`cautest.registry.suites` 是生成 Registry 的 C 标识符；`run.suite` 是运行过滤 Pattern。不要把两者合并成一个字段。

复杂 target 可以放到旁边的 `test-targets.lua`，由局部文件显式引入。大量测试的扩展单位是模块 Job，而不是每个源文件/Case 都生成一个 target。

## 5. MCU 的共享资源声明

```lua
-- tests/support/resources.lua
ctest.board {
    id = "board0",
    provider = {
        module = "./board-adapter.mjs",
        export = "createBoard"
    },
    options = {
        probeSerialEnv = "CTEST_PROBE_SERIAL",
        serialPortEnv = "CTEST_SERIAL_PORT"
    }
}
```

`createBoard` 的返回对象需要满足原有 JS Board 契约：`flash`、`reset`、`openTransport`、可选 `close`。Provider 构造不能马上烧写，资源锁和实际 I/O 在工作流执行期处理。上述 env 字段是示例 Provider 的数据约定，不能当作所有 Board 已内置支持的选项。

## 6. MCU 的 SPI/I2C Job 共用测试固件

```lua
-- tests/mcu/spi/test.lua
ctest.mcu {
    id = "integration.mcu.spi",
    target = "test.firmware",
    output = "firmware-bin",
    board = "board0",
    level = "integration",
    tags = {"mcu", "hardware", "spi"},
    run = {
        suite = {"spi_*"},
        caseTimeoutMs = 5000
    }
}
```

```lua
-- tests/mcu/i2c/test.lua
ctest.mcu {
    id = "integration.mcu.i2c",
    target = "test.firmware",
    output = "firmware-bin",
    board = "board0",
    level = "integration",
    tags = {"mcu", "hardware", "i2c"},
    run = {
        suite = {"i2c_*"}
    }
}
```

`test.firmware` 由 Xmake/BSP 的构建定义提供，输出 `firmware-bin` 需有对应 ELF/元数据及协议 Build ID 契约。Adapter 不会自动从产品 firmware 删除 main 再插入测试入口。

两个 Job 可以去重构建；默认仍分别获取资源、烧写/复位并完成测试，以保持隔离。是否共享一次烧写会话不由“target 名相同”自动决定。

## 7. Kernel 单测与 Driver ABI 必须分开

Kernel 内测试的声明：

```lua
ctest.kernel {
    id = "unit.driver.foo",
    target = "test.foo.kernel",
    output = "module",
    environment = "uml0",
    level = "unit",
    tags = {"kernel", "driver", "uml"}
}
```

Driver 用户接口测试的声明：

```lua
ctest.driver {
    id = "integration.driver.foo",
    drivers = {
        {target = "foo.driver", output = "module"}
    },
    guest = {
        target = "test.foo.abi",
        output = "primary"
    },
    environment = "uml0",
    level = "integration",
    tags = {"driver", "abi", "uml"},
    run = {
        suite = {"foo_*"}
    }
}
```

`uml0` 是项目共享 Environment 的命名引用，须在资源文件中声明；可以由 JS Provider 调用既有 `umlKernelEnvironment` 创建。Kernel/BusyBox/Rootfs 的过渡性构建只保留一份环境定义，产品 Driver 的 sources/defines 不应重复放回 JS。

以上不是声称现有 `driverAbiCTestJob` 可以直接接收这些 target 字段；XT-022/023 要完成产物 Provider 和 Runtime Steps 对接。

## 8. 拟提供的使用命令

```sh
# 只展示 Job 或工作流，不执行构建/烧写。
xmake ct --list
xmake ct --plan --tag=driver

# Level 是类别，多值 OR；Tag 多值 AND。
xmake ct --level=unit
xmake ct --level=unit,component --tag=native
xmake ct --tag=mcu,spi
xmake ct --tag=driver,abi

# 运行阶段 Case 选择不改变 Registry。
xmake ct --suite=spi_dma --case=transfer_4k integration.mcu.spi

# 区分 Cautest Profile 与 Xmake 公共 --profile。
xmake ct --test-profile=ci --level=unit
```

逗号列表是拟新增的参数规范化层，重复参数另经 P0 验证。无条件 `xmake ct` 延续“执行全部 enabled Job”的方向，可能实际烧写板卡；不能把它描述成默认只跑无硬件单测。


## 9. 保留 JS 自定义工作流出口

```lua
ctest.workflow {
    id = "integration.custom.protocol",
    level = "integration",
    tags = {"protocol", "external"},
    provider = {
        module = "./custom-workflow.mjs",
        export = "createWorkflow"
    },
    artifacts = {
        application = {target = "app", output = "primary"}
    },
    options = {
        scenario = "reconnect"
    }
}
```

该 JS Factory 用已有 `defineStep/defineFragment` 等 API 返回工作流输入，由 Bridge 创建正规 Job；产品的构建仍通过 ArtifactRef 调用 Xmake。公共 id/level/tags 不能由 provider 静默改写。复杂业务可使用第三方 JS 库或调用 Shell，但 Lua 不承担新的 Workflow DSL。
