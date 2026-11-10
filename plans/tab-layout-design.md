# Tab Layout Design

本文档定义 WebSSH RS 的 tab、拆分容器和内容视图模型，供后续前端拆分界面实现使用。

## 设计目标

- 使用一张 `tabs` 表保存普通 tab、拆分容器和拆分后的内容视图。
- 一个 tab 可以同时包含不同类型的内容，例如左侧 SSH、右侧 SFTP。
- 每个内容视图独立保存 `path` 和 `state`。
- 支持左右拆分、上下拆分、嵌套拆分和田字布局。
- 旧版本的平铺 tab 可以直接迁移为根内容节点。

## 数据表

表名：`tabs`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `TEXT PRIMARY KEY` | 节点唯一 ID。普通 tab、拆分容器和内容视图都使用此 ID。 |
| `parent_key` | `TEXT NULL` | 父节点 ID。根节点为 `NULL`。 |
| `split_direction` | `TEXT NULL` | `NULL` 表示内容视图；`horizontal` 表示左右拆分；`vertical` 表示上下拆分。 |
| `split_ratio` | `REAL NULL` | 拆分比例，例如 `0.5` 表示两侧各占 50%。内容视图为 `NULL`。 |
| `position` | `INTEGER NOT NULL` | 同一个父节点下的顺序，从 `0` 开始。 |
| `label` | `TEXT NULL` | 内容视图的显示名称。拆分容器为 `NULL`。 |
| `path` | `TEXT NULL` | 内容视图的路由，例如 `/terminal/1` 或 `/filesview/1`。拆分容器为 `NULL`。 |
| `state` | `TEXT NULL` | 内容视图的 JSON 状态。拆分容器为 `NULL`。 |

表中不设置 `node_type`。节点类型由 `split_direction` 决定：

```text
split_direction IS NULL
    -> 内容视图节点

split_direction IS NOT NULL
    -> 拆分容器节点
```

`parent_key` 只表达父子关系，不能单独用于判断节点类型。根节点可以是未拆分的内容视图，也可以是拆分容器。

## 节点类型

### 未拆分 tab

一个根内容节点就是一个普通 tab：

```text
key              = t1
parent_key       = NULL
split_direction  = NULL
split_ratio      = NULL
position         = 0
label            = SSH Server
path             = /terminal/1
state            = NULL
```

此时 `active_tab_key` 指向 `t1`。

### 拆分容器

拆分容器只负责布局，不负责显示内容：

```text
key              = s1
parent_key       = NULL
split_direction  = horizontal
split_ratio      = 0.5
position         = 0
label            = NULL
path             = NULL
state            = NULL
```

它的子节点通过 `parent_key = s1` 关联。

### 内容视图

内容视图是最终被渲染的叶子节点：

```text
key              = v1
parent_key       = s1
split_direction  = NULL
split_ratio      = NULL
position         = 0
label            = SSH Server
path             = /terminal/1
state            = NULL
```

```text
key              = v2
parent_key       = s1
split_direction  = NULL
split_ratio      = NULL
position         = 1
label            = SFTP Server
path             = /filesview/1
state            = {"cwd":"sftp:1:/home"}
```

`v1` 和 `v2` 是同一个 tab 内的两个独立视图，类型和状态互不影响。

## 布局示例

### 左右拆分

```text
s1 horizontal
├── v1 SSH
└── v2 SFTP
```

对应数据：

```text
s1: parent_key = NULL, split_direction = horizontal, split_ratio = 0.5
v1: parent_key = s1,   split_direction = NULL,       position = 0
v2: parent_key = s1,   split_direction = NULL,       position = 1
```

### 上下拆分

```text
s1 vertical
├── v1 SSH
└── v2 SFTP
```

只需要把容器的 `split_direction` 设置为 `vertical`。

### 田字布局

通过嵌套拆分容器表达：

```text
s1 horizontal
├── s2 vertical
│   ├── v1 SSH
│   └── v2 SFTP
└── s3 vertical
    ├── v3 SSH
    └── v4 SFTP
```

数据关系：

```text
s1: parent_key = NULL, split_direction = horizontal
s2: parent_key = s1,   split_direction = vertical
s3: parent_key = s1,   split_direction = vertical
v1: parent_key = s2,   split_direction = NULL, position = 0
v2: parent_key = s2,   split_direction = NULL, position = 1
v3: parent_key = s3,   split_direction = NULL, position = 0
v4: parent_key = s3,   split_direction = NULL, position = 1
```

## 状态保存

当前阶段 `state` 只需要保存 SFTP 当前目录：

```json
{
  "cwd": "sftp:1:/home"
}
```

状态属于内容视图，不属于顶部 tab，也不属于拆分容器。后续可以继续增加：

```json
{
  "cwd": "sftp:1:/home",
  "selected_files": [],
  "scroll_top": 120
}
```

SSH 和 SFTP 即使位于同一个 tab 中，也必须使用不同节点和不同 `state`。

## 前端实现约定

1. 先根据 `parent_key` 建立节点树。
2. `split_direction` 为空的节点渲染实际内容组件。
3. `split_direction` 不为空的节点渲染拆分容器，并根据 `position` 排列子节点。
4. `split_ratio` 用于设置拆分容器的初始尺寸；拖动调整后更新该字段。
5. 顶部 tab 列表使用根节点，即 `parent_key = NULL` 的节点。
6. `active_tab_key` 保存当前顶部 tab 的根节点 key。
7. 内容组件更新目录或页面状态时，只更新对应叶子节点的 `state`。
8. 删除拆分容器时，需要先处理其子树；不能留下孤立节点。

## 数据约束

- `key` 必须唯一。
- `parent_key` 必须指向同一布局树中的节点，不能形成环。
- 内容视图的 `split_direction` 和 `split_ratio` 必须为 `NULL`。
- 拆分容器必须有非空 `split_direction` 和 `split_ratio`。
- 同一父节点下的 `position` 必须唯一且连续，前端重排后重新编号。
- 拆分容器至少有两个子节点。
- `split_ratio` 建议限制在 `(0, 1)`，默认值为 `0.5`。
- 拆分容器的 `label`、`path`、`state` 必须为空。

## 旧数据迁移

旧版本每个 tab 都是一个平铺内容节点，迁移时保持原有 key、label、path 和 state：

```text
旧 tab
  -> tabs.key
  -> tabs.parent_key = NULL
  -> tabs.split_direction = NULL
  -> tabs.position = 原列表顺序
  -> tabs.label/path/state = 原字段
```

这样旧数据不需要创建虚拟拆分容器，也不会改变用户现有的 tab 顺序。
