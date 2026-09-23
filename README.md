# Notion DB Sync

两个 Notion 数据库之间的**单向同步**工具：以 A 库为准，把记录同步到 B 库。

按 `Sync ID` 属性配对——B 端有对应记录就更新，没有就新建。B 端多出来的记录（A 端已不存在）可选归档。

> 代码日志里把 A 端称作 `Seotter`、B 端称作 `Synova`，那只是某次实际部署的库名，换库不影响逻辑。

## 目录结构

```
sync-db.js          同步主程序
test-notion.js      连通性自检（只读，查 3 条样本）
versions/           历史版本 v1.0 → v1.3
.env.example        环境变量模板（复制成 .env 再填）
```

## 工作原理

1. `databases.retrieve` 拿到两端库的 `data_sources[0].id`（Notion API v5 起，查询要基于 data source）
2. 分页拉取 A 端**全部**记录
3. 拉取 B 端全部记录，建立 `Sync ID → page` 缓存
4. 按 `Sync ID` 逐条 upsert，**每批 10 条并发**，带进度输出
5. 可选：归档 B 端存在、A 端已没有的记录

### Sync ID 的约定（关键）

- **A 端**：Notion 内置的 **Unique ID** 属性，例如 `SN-42`
- **B 端**：**文本**属性，值同样是 `SN-42`
- 写入 B 时只写 `前缀-数字`；读取时会把 `SN-` 前缀剥掉再比对，所以两端写法不完全一致也能对上

### 字段复制规则

- `select` / `multi_select` **只按名字复制**，不带 option 的 `id` 和 `color`——跨库时 option id 不通用，这是刻意的
- 其余字段**原样透传**
- ⚠️ 所以如果 A 端含有只读字段（公式、汇总、创建时间等），或两端同名字段类型不一致，Notion 会拒绝写入

## 环境准备

1. 在 Notion 建两个 **internal integration**，分别拿到 token（`ntn_` 开头）
2. **把两端数据库分别共享给对应的 integration**（库页面 `...` → Connections → 添加）——漏了这步会 404
3. 取两个库的 ID（浏览器地址里那串 32 位十六进制）

## 安装与配置

```bash
npm install
cp .env.example .env        # Windows 上用 copy .env.example .env
```

然后编辑 `.env`：

```dotenv
A_TOKEN=ntn_xxx
A_DATABASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
B_TOKEN=ntn_yyy
B_DATABASE_ID=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
```

## 运行

```bash
node test-notion.js      # 先自检：连通性 + 能否查询
node sync-db.js          # 正式同步
```

`test-notion.js` 是**只读**的，随便跑。

## 危险开关

`sync-db.js` 顶部：

```js
const ARCHIVE_MISSING_IN_A = true;    // 是否归档 B 端多余记录
const MIN_A_RECORDS_FOR_ARCHIVE = 5;  // 安全阈值
```

归档是**写入操作**：A 端没有、B 端有的记录会被置为 `archived`。

唯一的保险是"A 端记录数 ≥ 5"——也就是说，只要 A 端返回的记录数不少到 5 条以下，B 端该归档的就会被批量归档。动这两个值之前请先想清楚。

目前**没有 dry-run**。想先看效果，把 `ARCHIVE_MISSING_IN_A` 改成 `false` 跑一次。

## 已知限制

- 无 dry-run、无增量同步（每次全量拉取）
- 只归档不删除
- 并发固定 10，没有速率限制退避
- 单向：只 A → B
- 未处理 `relation` / `rollup` / 公式类字段的跨库映射

## 安全

- **不要把 `.env` 提交进仓库**（`.gitignore` 已忽略）
- token 一旦泄露，立刻去 Notion 吊销重发

## 版本

`versions/` 保留了迭代过程：

- `v1.0` / `v1.1`：顺序同步
- `v1.2`：改为每批 10 条并发
- `v1.3`：当前版本，与根目录 `sync-db.js` 内容一致