# PLAN-006 Migrate from Biome to ESLint + Prettier

- **task**: LINT-001
- **status**: completed
- **owner**: claude

## Context

Biome (Rust binary) frequently core dumps during lint runs. The `ulimit -c 0` workaround only suppresses the dump file but the process still crashes. Migration to ESLint + Prettier eliminates this instability.

## Steps

1. Install ESLint + Prettier packages at root
2. Create `eslint.config.js` (flat config) mapping all Biome rules
3. Create `.prettierrc` + `.prettierignore`
4. Update root `package.json` scripts, remove `@biomejs/biome`
5. Convert `biome-ignore` comments → `eslint-disable` equivalents
6. Delete `biome.json`
7. Update docs (CLAUDE.md, AGENTS.md, development.md, architecture.md, frontend README)
8. Run format + lint + tests to verify

## Rule Mapping

| Biome Rule                      | ESLint Equivalent                                           |
| ------------------------------- | ----------------------------------------------------------- |
| `noRestrictedImports` (zod)     | `no-restricted-imports`                                     |
| `useImportType` (separatedType) | `@typescript-eslint/consistent-type-imports`                |
| `useNodejsImportProtocol`       | `@typescript-eslint/no-require-imports` + manual            |
| `useConst`                      | `prefer-const`                                              |
| `noImplicitAnyLet`              | `@typescript-eslint/no-inferrable-types` (partial)          |
| `noDuplicateObjectKeys`         | `no-dupe-keys`                                              |
| `noTsIgnore`                    | `@typescript-eslint/ban-ts-comment`                         |
| `noDebugger`                    | `no-debugger`                                               |
| `noDelete`                      | `no-restricted-syntax` (UnaryExpression[operator='delete']) |
| `useDateNow`                    | — (no direct equivalent, skip)                              |
| `noUselessSwitchCase`           | `no-fallthrough` (partial)                                  |
| `noUnusedImports`               | `@typescript-eslint/no-unused-vars`                         |
| `noMisusedPromises`             | `@typescript-eslint/no-misused-promises`                    |
| `noFloatingPromises`            | `@typescript-eslint/no-floating-promises`                   |
| React recommended               | `eslint-plugin-react-hooks`                                 |

## Formatter Config (Prettier)

- `semi: false` (matches `semicolons: "asNeeded"` with no-semi convention)
- `singleQuote: true`
- `tabWidth: 2`
- `trailingComma: "all"`
- `printWidth: 100`

---

# PLAN-006b stdout 断裂后 fallback 到 transcript JSONL

- **status**: completed
- **task**: STALL-001

## 背景

Claude CLI 进程的 stdout pipe 偶发性异常关闭（Bun pipe bug 或 Claude CLI hook 子进程关闭 fd），
但进程继续运行并写入 transcript JSONL。BKD 的 consumeStream 提前结束后，
只能等 stall detection（3+3+3=9 分钟）才能 force-kill 并 resume，导致时间浪费和日志丢失。

## 调查发现

### 时间线（真实案例）

- `21:59:24` — stdout_stream_ended（pipe 断裂），consumeStream resolve
- `21:59:24-21:59:33` — Claude CLI 继续执行：Bash(git commit)、新 API 请求、Stop hook
- `22:02:11` — stall_detected（3min 静默）
- `22:05:11` — stall_probe（6min，发送 interrupt）
- `22:08:11` — stall_force_kill（9min，SIGKILL）

### transcript JSONL

- 路径：`~/.claude/projects/${cwd.replaceAll('/', '-')}/${sessionId}.jsonl`
- 格式：每行一个 JSON 对象，`type` 字段有 `assistant`/`user`/`system`/`progress`/`queue-operation`
- 由 Claude CLI 内部直接写入（appendFileSync），与 stdout fd 无关
- stdout 断裂时仍在正常写入

### 关键代码路径

- `register.ts:125-142` — consumeStream resolve 后只记日志，不做任何恢复
- `completion-monitor.ts:61` — 等待 subprocess.exited（如果进程不退出就一直等）
- `gc.ts:142-289` — stall detection 三阶段（2+2+2=6min 检测 + force kill）
- `normalizer.ts` — stream-json → NormalizedLogEntry 解析器

## 方案

### 核心思路

在 `register.ts` 的 consumeStream `.then()` 中检测 stdout 断裂（进程仍存活），
启动 transcript tail fallback：

1. 从 transcript JSONL 读取 stdout 断裂后的新条目
2. 用现有 normalizer 解析为 NormalizedLogEntry，push 到 callbacks
3. 检测到 turn completion 后主动 settle

### 改动文件

1. **`apps/api/src/engines/issue/streams/transcript-fallback.ts`**（新建）
   - `tailTranscript(transcriptPath, lastSeenUuid, parser, callbacks)` 函数
   - 读取 JSONL 文件，跳过 lastSeenUuid 之前的条目
   - 将 transcript 格式转换为 stream-json 格式，复用 normalizer 解析
   - 检测 `system.subtype === 'stop_hook_summary'` 或助理最终消息作为 turn completion 信号
   - 处理完后返回，由调用方 settle

2. **`apps/api/src/engines/issue/process/register.ts`**（修改）
   - consumeStream `.then()` 中：检测进程是否存活
   - 如果存活：构造 transcript path，调用 tailTranscript fallback
   - fallback 完成后：标记 turnSettled，主动 settle issue

3. **`apps/api/src/engines/issue/types.ts`**（修改）
   - ManagedProcess 添加 `stdoutBroken?: boolean` 字段标记断裂状态
   - 添加 `lastSeenUuid?: string` 跟踪最后处理的消息 UUID

4. **`apps/api/src/engines/issue/gc.ts`**（修改）
   - stall detection 检查 `stdoutBroken` 标记
   - 如果已标记且 fallback 正在进行，跳过 stall escalation

### transcript 格式转换

transcript JSONL 的 `assistant` 条目结构：

```json
{
  "type": "assistant",
  "message": { "role": "assistant", "content": [...] },
  "uuid": "...",
  "timestamp": "..."
}
```

stream-json stdout 的 `assistant` 条目结构：

```json
{
  "type": "assistant",
  "message": { "role": "assistant", "content": [...] },
  "session_id": "...",
  "uuid": "..."
}
```

两者的 `message` 结构一致，差异仅在顶层元数据字段。
normalizer 的 `parse()` 方法只关心 `type` 和 `message`，可以直接复用。

### 风险

1. **transcript 写入延迟** — Claude CLI 可能缓冲写入，但实际使用 `appendFileSync` 所以立即落盘
2. **格式耦合** — transcript 是 Claude CLI 内部格式，升级可能变化。
   但核心的 `assistant.message` 结构与公开的 stream-json 一致，风险低
3. **并发读写** — BKD 读取时 Claude CLI 可能正在追加。
   逐行读取 + 容忍不完整尾行即可

## 替代方案

- **方案 4（简单 settle）**：stdout 断裂即 settle + resume。缺点：丢失断裂后的日志和工作。
- **Bun.file() 重定向**：如果是 Claude CLI 侧问题（关闭 fd 1），同样无效。
