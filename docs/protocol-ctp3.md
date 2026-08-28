# CTP3 行协议

CTP3 是 Cautest Host 与 C Target 共用的有序文本协议。当前版本为 `3.1`：Major 不同直接拒绝，Minor 由具体能力和事件格式约束。它运行在可靠、保序、不重复的字节流上；Pipe、UML Control Endpoint 和由 Board Adapter 管理恢复的串口都可以承载。

连接按 `HELLO → LIST → CASE/SUITE execution → BYE` 推进。HELLO 返回 Protocol、Build ID、Boot ID 与收发 Line 上限；Host 可以同时约束 Build ID 和 Boot ID。LIST 流式返回从零开始的 `suiteId/caseId/paramId`，这些 ID 只在当前连接有效，持久结果使用名称。

Host 的命令以 LF 结束且不得超过 64 B。Target 响应默认不得超过 512 B；Decoder 接受 LF 或 CRLF、支持任意字节分片，并在超长行后丢弃到下一处 LF 再恢复。字段中的反斜线、逗号、换行、回车和控制字符分别使用 `\\`、`\,`、`\n`、`\r`、`\xHH`。无效 UTF-8、转义、字段数、ID 或事件顺序都使 Session 成为 `protocol_error`。

## 完整执行命令

`AT+CASE=<executionId>,<suiteId>,<caseId>,<paramId>` 执行一个完整 Case Fixture 生命周期；`AT+SUITE=<executionId>,<suiteId>,<policy>` 在一次 Suite setup/teardown 之间执行所有实例。Policy 为 `CONTINUE`、`STOP_ON_FAIL` 或 `STOP_ON_ERROR`。Execution ID 是连接内严格递增的非零 u32。

Target 在执行过程中按顺序发送 `EXEC-START`、Suite/Case Start、Assertion/Fault/Log、Case/Suite End 和 `EXEC-END`，最后才发送 `OK:CASE` 或 `OK:SUITE`。Final Response 只说明命令完整结束；PASS/FAIL/SKIP/ERROR 来自事件。Fixture 在 Case 开始前失败时不会伪造 Case Start，Host 会把该 Execution 记录为基础设施或 Group 诊断。

CTP3.1 不定义 CANCEL。执行超时意味着当前连接不再可信：Host 关闭 Transport，并由 Native Process、UML Resource 或 Board Adapter 完成终止/Reset；重新连接后重新 HELLO 和 LIST，不续跑旧 Execution。

`ASSERT` 保留整数 expected/actual；`ASSERT2` 为 u64、pointer、string 和 bytes 提供带类型值。`LOG`/`LOG-TRUNC` 通过 TARGET、EXEC、SUITE、CASE Scope 关联执行，但日志不能决定测试状态。

协议的 JS Codec/Session 位于 `src/protocol/`，C Parser/Server 位于 `assets/cautest-c/protocol/ctp3.c`。两侧变更必须同时通过 C Protocol、JS Codec 和 Session 测试。
