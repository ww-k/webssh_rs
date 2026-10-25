# SFTP 批量传输与目录传输方案

## 1. 目标与现状

当前实现中：

- `transfer_task` 一条记录就是一个文件传输任务。
- `TransferService`、断点续传、暂停和恢复都围绕单文件实现。
- 前端多选文件时，会创建多个独立的顶层任务。
- 远程下载目前禁止目录，后端上传和下载接口也会拒绝目录。

目标模型：

```text
TransferBatch          批量传输任务
    ├── TransferTask   文件传输任务
    ├── TransferTask   文件传输任务
    └── TransferTask   目录扫描任务
```

`TransferBatch` 是可选的界面聚合记录，`TransferTask` 是唯一的运行事实和调度队列。文件任务和目录任务都记录在 `transfer_task`，通过 `kind=FILE|DIRECTORY` 区分。没有 `transfer_batch` 记录时，任务仍然可以独立调度、暂停、恢复和完成。

## 2. 后端数据模型

### 2.1 可选的 `transfer_batch` 表

建议字段：

```text
id                  TEXT PRIMARY KEY
type                UPLOAD | DOWNLOAD
status              WAIT | RUN | PAUSE | SUCCESS | FAIL | CANCEL
name                批次显示名称
target_id           SFTP 目标 ID
conflict_policy     OVERWRITE | SKIP | RENAME | FAIL

item_count          文件 transfer_task 总数
completed_count     已完成文件任务数
failed_count        失败文件任务数
directory_count     目录任务总数
directory_failed_count 失败目录任务数
total               已发现文件的总字节数，扫描中持续增加
loaded              已传输字节数
percent             扫描完成后才提供确定的总体百分比
speed               当前总速度
estimated_time      剩余时间

fail_reason
created_at
updated_at
ended_at
```

批次表只保存界面需要的名称、方向和可重建的聚合缓存，不保存源路径，也不参与调度、恢复或完成判断。`batch_id` 是任务表中的逻辑分组 ID，不建立外键约束；它可以没有对应的 `transfer_batch` 行。目录递归任务必须使用非空 `batch_id`，即使没有 UI 批次记录也要生成一个逻辑分组 ID，以保证子任务幂等和批次聚合；单个独立文件任务可以为空。创建批次时，初始 `transfer_task` 行必须在一个数据库事务中原子入库；批次元数据可以同事务写入，但不是任务运行的前置条件。之后所有状态和进度都以 `transfer_task` 为准。

### 2.2 统一 `transfer_task` 表

文件传输任务和目录扫描任务都使用同一张表，通过 `kind` 区分：

```text
id                  TEXT PRIMARY KEY
batch_id            逻辑批次 ID；目录递归任务必填，独立文件任务可空，不建立外键
kind                FILE | DIRECTORY
type                UPLOAD | DOWNLOAD
status              WAIT | RUN | PAUSE | SUCCESS | FAIL | CANCEL
name                文件或目录名称
local_path          本地源或目标路径
target_uri          远程目标或源 URI
relative_path       相对于批次根目录的相对路径
target_id           SFTP 目标 ID

# FILE 任务字段
loaded
total
percent
speed
estimated_time
ranges

fail_reason
created_at
updated_at
ended_at
```

`transfer_task` 是唯一的运行事实和调度队列。`kind=FILE` 时，状态、进度、ranges 和错误只表示该文件；`kind=DIRECTORY` 时，任务只表示创建目录并读取当前目录子项，文件进度字段为空或为默认值。

目录任务执行流程固定为：

1. 创建目标目录，失败则任务为 `FAIL`。
2. 读取当前目录子项。
3. 发现文件时插入新的 `kind=FILE` 任务并立即入文件传输队列。
4. 发现目录时插入新的 `kind=DIRECTORY` 任务并立即入目录扫描队列。
5. 当前目录的所有子项入库后，当前目录任务标记 `SUCCESS`，不等待子任务完成。

建议增加索引：

```text
(status, kind, created_at)
(batch_id, status)
UNIQUE(batch_id, relative_path, kind)
```

客户端多选文件限定在同一目录下，因此 `(batch_id, relative_path, kind)` 足以保证批次内幂等。没有 UI 批次时，目录递归仍使用仅存在于任务表中的逻辑 `batch_id`；只有独立文件任务可以没有 `batch_id`。

### 2.3 任务完成与批次完成

目录任务成功只表示自身已经创建目录并完成当前目录读取；它不依赖子文件或子目录任务。目录任务失败时，已经创建的文件任务继续传输，批次最终汇总目录失败。

创建目录和读取子项属于文件系统/SFTP 操作，不放入数据库事务。读取完成后，在一个数据库事务中完成“插入文件和目录子任务、将当前目录任务标记为 `SUCCESS`”。如果事务提交失败，当前目录保持可重试状态，下一次通过唯一约束和 upsert 去重。

批次是否完成直接由任务表判断，不依赖 `transfer_batch`：

```text
该 batch_id 下不存在 WAIT、RUN、PAUSE 任务
```

批次聚合状态建议按以下优先级计算：

```text
存在 RUN       -> RUN
否则存在 WAIT  -> WAIT
否则存在 PAUSE -> PAUSE
否则存在 FAIL  -> FAIL
否则存在 CANCEL -> CANCEL
否则           -> SUCCESS
```

当目录任务插入子任务和自身变为 `SUCCESS` 在同一事务中提交后，不需要额外的 `discovery_complete` 字段；所有任务进入终态即可证明目录发现已经结束。批次表中的状态、数量、字节数和百分比都只是缓存，可随时从 `transfer_task` 重建。

## 3. 批次创建流程

### 3.1 上传目录

请求示例：

```json
{
  "target_uri": "sftp:1:/opt/upload",
  "sources": [
    "C:/work/project"
  ],
  "conflict_policy": "OVERWRITE"
}
```

后端在一个数据库事务中创建初始的 `kind=DIRECTORY` 任务；批次界面记录可以同事务写入，也可以在任务提交后异步写入。随后启动统一任务调度器。目录任务先创建目标目录，再读取子项：发现子目录就插入新的 `kind=DIRECTORY` 任务并入队，发现文件就读取大小、插入独立的 `kind=FILE` 任务并立即入文件传输队列。当前目录的子项全部持久化后，该目录任务标记 `SUCCESS`。即使批次界面记录缺失，任务表中的目录和文件任务仍可正常运行。

选择多个文件时，文件直接放在目标目录下；选择目录 `project`，目标结构为 `目标目录/project/...`。

遍历使用 `symlink_metadata`，默认不跟随符号链接，避免循环和越权访问。

### 3.2 下载目录

请求示例：

```json
{
  "sources": [
    "sftp:1:/var/logs"
  ],
  "local_dir": "D:/Downloads",
  "conflict_policy": "OVERWRITE"
}
```

后端在一个数据库事务中创建初始的 `kind=DIRECTORY` 任务；批次界面记录可以同事务写入，也可以在任务提交后异步写入。随后由统一任务调度器执行本地目录创建和 SFTP `read_dir`。发现子目录时插入新的 `kind=DIRECTORY` 任务并入队；发现文件时获取属性并立即创建 `WAIT` 的 `kind=FILE` 任务，使其与后续目录扫描并行。下载 `/var/logs` 到 `D:/Downloads` 时，默认生成 `D:/Downloads/logs/...`。

每次只展开一个目录，不把整棵目录树载入内存。任务状态和待扫描目录都持久化在同一张表中。现有 SFTP `read_dir` 若会将一个目录的所有条目收集到 `Vec`，还需增加逐页/逐项读取接口；否则有界目录队列只能限制整棵树的内存，不能限制单个超大目录的内存。

## 4. 调度与执行

现有 `run_upload`、`run_download`、`mark_range_done` 和范围断点逻辑继续复用。

调度器规则：

1. 所有 `WAIT` 任务从同一张 `transfer_task` 表中读取。
2. `kind=FILE` 任务受 `WEBSSH_RS_TRANSFER_TASK_CONCURRENCY` 限制；`kind=DIRECTORY` 任务使用独立的有界扫描队列。
3. 多个批次采用轮询方式选择文件，避免大目录独占全部文件并发。
4. 目录任务必须先创建目标目录，再读取子项；子目录任务可以独立继续。
5. 单个文件失败后继续处理同一批次的其他文件。

批次状态：

```text
WAIT       等待调度
RUN        正在扫描目录和/或执行已发现的文件任务
PAUSE      用户暂停或服务重启后暂停
SUCCESS    所有任务成功或跳过
FAIL       存在目录任务错误或失败文件任务
CANCEL     用户取消
```

批次聚合中的 `item_count` 和 `total` 只统计 `kind=FILE` 任务；目录扫描尚未完成时，任务表中仍会存在 `WAIT/RUN` 的目录任务，不能将暂时没有待传文件误判为批次完成。

暂停批次时按 `batch_id` 将任务表中的活动任务暂停，中止运行中的文件任务，目录任务从头幂等执行。恢复时按 `batch_id` 将任务重新置为 `WAIT`，文件任务保留 ranges，目录任务重新创建目录并读取子项。文件任务失败后，统一调用 `resume` 接口重新排队，成功任务不重复执行。取消时按 `batch_id` 停止所有任务，临时文件默认清理。

服务重启后，只查询 `transfer_task` 表，将 `RUN` 任务转为 `PAUSE`。文件任务保留 ranges；目录任务从创建目录阶段重新执行，目录创建必须幂等，子项通过 `(batch_id, relative_path, kind)` 唯一约束和 upsert 避免重复创建任务。没有批次表记录的任务也按同样规则恢复。

扫描过程中发生目录读取错误时，记录对应目录错误并继续扫描其他已排队目录和传输已发现文件；扫描结束后批次汇总为 `FAIL`。恢复批次时可继续失败目录和文件。

## 5. 冲突和临时文件

统一支持：

```text
OVERWRITE 覆盖
SKIP      跳过
RENAME    自动改名
FAIL      冲突即失败
```

建议使用临时文件避免失败任务留下完整目标文件：

```text
下载：file.txt.part -> file.txt
上传：file.txt.webssh-part -> file.txt
```

传输成功后执行 rename；恢复时继续使用临时文件和已有 ranges。

## 6. 后端 API

现有单文件接口继续保留，内部创建单文件批次：

```text
POST /api/transfer/upload
POST /api/transfer/download
```

新增批次接口：

```text
POST   /api/transfer/batches/upload
POST   /api/transfer/batches/download
GET    /api/transfer/batches
GET    /api/transfer/batches/{batch_id}
GET    /api/transfer/batches/{batch_id}/items
POST   /api/transfer/batches/{batch_id}/pause
POST   /api/transfer/batches/{batch_id}/resume
POST   /api/transfer/batches/{batch_id}/cancel
DELETE /api/transfer/batches/{batch_id}
```

批次使用 `POST /api/transfer/batches/{batch_id}/resume`，接口实际按 `batch_id` 操作 `transfer_task`；单个任务使用现有的 `POST /api/transfer/{id}/resume`。批次恢复时将暂停或失败的目录/文件任务重新置为 `WAIT`，批次表不存在也不影响该操作。

批次响应由 `transfer_task` 聚合生成，至少包含批次状态、方向、名称、文件任务数、目录任务数、成功数、失败数、文件总字节数、已传字节数、百分比、速度和剩余时间。扫描未完成时百分比和剩余时间为空；子任务列表直接分页查询 `transfer_task`，避免大型目录一次返回数万条记录。`transfer_batch` 中的缓存字段不一致时，以该查询结果为准。

## 7. 前端任务服务

`src-client/src/services/transfer/index.ts` 改为管理批次，增加：

```ts
createUploadBatch(...)
createDownloadBatch(...)
getBatch(...)
getBatchItems(...)
pauseBatch(...)
resumeBatch(...)
cancelBatch(...)
```

保留现有 `upload()` 和 `download()`，内部调用批次接口创建单文件批次。旧版单文件任务在前端收到后包装成单文件批次，保证历史任务继续显示。

轮询规则：通过 `transfer_task` 聚合查询批次；有 `WAIT/RUN` 任务时每秒刷新；批次展开后再分页拉取同一 `batch_id` 的任务。扫描未完成时显示“已传输字节/已发现字节”和扫描中状态，不显示整体百分比；发现字节总量会持续变化，等不存在活动目录任务后再显示确定的总体百分比和剩余时间。

## 8. 前端传输面板

当前单层表格改为两层：

```text
[展开] project       上传  18/42 个文件  48%
       ├── src/main.rs
       ├── src/lib.rs
       ├── README.md
       └── empty-dir/
```

批次行显示名称、方向、文件统计、总体进度、总速度、剩余时间和批次操作。扫描过程中显示扫描状态、已发现文件数和已传输/已发现字节数；扫描完成后显示确定的总体进度。展开后的列表直接展示 `transfer_task`：文件任务显示单文件进度，目录任务显示创建/扫描状态。批次表缺失时，仍可按 `batch_id` 从任务表重建界面。

批次级操作包括暂停、恢复、取消、删除历史；这些操作直接按 `batch_id` 更新 `transfer_task`。批次为 `FAIL` 时，恢复操作会继续所有失败/暂停的目录和文件任务。文件级操作包括查看错误和通过现有 `resume` 接口恢复单项。

## 9. SFTP 文件列表入口

远程下载去掉当前对目录的禁用逻辑。文件和目录可以混合选择，选择结果只创建一个下载批次。

上传菜单增加文件、目录以及文件和目录混合选择。

本期只通过本地文件选择器选择文件或目录，后端使用选择结果中的本地路径创建批次；不支持操作系统拖拽或浏览器 `File` 对象上传。

## 10. 数据库迁移与兼容

新增 SeaORM migration：

1. 给现有 `transfer_task` 增加 `kind`、`batch_id`、`relative_path`，文件历史任务默认填充 `kind=FILE`。
2. 将目录任务也写入 `transfer_task`，目录专用文件字段为空或默认值。
3. 创建可选的 `transfer_batch` UI 聚合表，不建立外键，不作为调度和状态来源。
4. 旧任务保留空 `batch_id`，继续独立运行。
5. 批次查询和历史恢复都以 `transfer_task` 为准，批次记录缺失时可以重建。

`transfer_batch` 不能作为任务队列或状态来源。它可以被删除、重建或延迟刷新；调度、暂停、恢复、重启恢复和批次完成判断全部直接查询 `transfer_task`。

## 11. 实施阶段

### 阶段一：批次模型

- 给 `transfer_task` 增加 `kind`、`batch_id`、`relative_path` 和必要索引。
- 新增可选的 `transfer_batch` UI 聚合记录。
- 现有单文件任务可生成独立的逻辑 `batch_id` 和 UI 批次记录，也可继续无批次独立运行。
- 前端支持批次行和展开行。
- 保留旧 API。

### 阶段二：多文件批次

- 新增批次上传和下载 API。
- 多选文件合并为一个批次。
- 实现按 `batch_id` 的任务调度、暂停、取消、`resume` 和聚合进度。

### 阶段三：目录传输

- 本地目录递归扫描。
- 远程目录递归扫描。
- 空目录处理。
- 冲突策略。
- 临时文件和原子 rename。

## 12. 验收标准

1. 多选多个文件只产生一个批次。
2. 上传和下载目录都能保留完整层级。
3. 空目录能够传输。
4. 同一批次可以展开查看全部文件任务。
5. 扫描目录时，已发现文件可在剩余目录扫描完成前开始传输。
6. 大目录树不会整体载入内存，扫描队列有界且可持久化。
7. 批次暂停后扫描器和传输调度器都停止继续工作。
8. 服务重启后从持久化队列恢复，重读目录不会产生重复子任务。
9. 扫描未完成时不会显示虚假的完成百分比或将批次提前结束。
10. 单个文件失败不会阻塞其他文件。
11. 支持通过 `resume` 继续失败文件。
12. 冲突策略行为一致。
13. 不允许相对路径逃逸目标目录。
14. 符号链接不会导致递归循环。
15. 大目录扫描不会阻塞 HTTP 请求。
16. 旧单文件任务和旧 API 继续可用。
17. 删除或缺失 `transfer_batch` 记录不会影响任务调度、恢复和完成。

推荐默认决策：所有批量传输使用 `batch_id` 逻辑分组，`transfer_batch` 仅作为可选 UI 聚合记录；目录默认保留根目录，文件失败后继续其他文件，批次最终以 `transfer_task` 汇总结果为准，旧接口保留兼容。
