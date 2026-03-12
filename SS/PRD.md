# 流光数据中台 - 产品需求文档 (PRD V6)

> 版本：V6 | 更新日期：2026-03-12 | 状态：已实现

---

## 1. 产品概述

### 1.1 产品定位

**流光数据中台 (Liuguang)** 是一款面向企业的智能数据中台。它通过 LLM 驱动的 ETL 管道，将员工散落在飞书（Lark）多维表格、云文档、聊天记录和会议纪要中的多源异构数据，自动采集、智能清洗、标准化存储，形成可检索、可分析、可复用的企业数据资产。平台内置知识图谱构建和混合 RAG 检索能力，并持续探索 AI 问答、报告生成等智能应用。

### 1.2 核心业务闭环

```
数据采集 → 智能清洗 → 资产沉淀 → 知识图谱 → 数据应用
```

1. **多源数据采集**：ETL 引擎 + 本地上传 + 云文档同步 + 结构化表格导入
2. **智能数据处理**：LLM Schema 映射 + 提取规则引擎（4 大行业模板）+ 清洗规则引擎（7 种清洗选项）+ 内容增强
3. **标准化资产存储**：三大内容表 + 标签体系 + 行级权限隔离
4. **知识图谱构建**：自动实体关系提取 + 社区发现 + 洞察生成
5. **数据应用层（探索中）**：RAG 问答、报告生成、日程管家、智能待办

### 1.3 目标用户

| 角色 | 权限 | 核心场景 |
|------|------|----------|
| 普通员工 (employee) | 仅看自己的数据 + 被共享的数据 | 数据导入、查看看板、管理标签 |
| 管理员 (admin) | 全局数据可见 + 系统配置 | ETL 管理、数据源配置、权限设置、系统运维 |

---

## 2. 技术架构

### 2.1 技术栈

| 层级 | 技术选型 |
|------|----------|
| 前端框架 | React 19 + TypeScript 5.9 + Vite 7 |
| 路由 | React Router 7（嵌套路由 + Outlet） |
| 状态管理 | TanStack React Query 5（服务端状态） |
| 样式 | Tailwind CSS 4（utility-first，无组件库） |
| 动画 | Framer Motion 12 |
| 图表 | Recharts 3 + D3 7（知识图谱力导向布局） |
| 图标 | Lucide React |
| 通知 | react-hot-toast |
| 后端框架 | FastAPI (Python 3.10+，全异步)，24 个 API Router，约 110 个端点 |
| ORM | SQLAlchemy 2.0 async + asyncpg |
| 数据库 | PostgreSQL 16 + pgvector 扩展（1024 维向量） |
| 任务调度 | APScheduler (AsyncIOScheduler) |
| 身份认证 | 飞书 OAuth 2.0 SSO → JWT (HS256, 24h) |
| LLM | OpenAI 兼容接口（GLM-4.5/GLM-5/DeepSeek/Qwen） |
| Embedding | BAAI/bge-m3（1024 维） |
| ASR | FunASR（语音转文字） |
| 视觉理解 | Qwen3-VL-8B（图片内容提取） |
| 部署 | Docker Compose（PostgreSQL + Backend + Nginx） |

### 2.2 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端 (Nginx:80)                          │
│  React 19 + Tailwind CSS 4 + TanStack Query + D3 知识图谱       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ /api 反向代理
┌──────────────────────────▼──────────────────────────────────────┐
│                    后端 (FastAPI:8000)                           │
│  24 个 API Router │ 22 个模型文件 │ ~110 个端点 │ SSE 流式输出   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Auth/RBAC│ │ ETL管道  │ │ 提取规则 │ │ 清洗规则 │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ RAG引擎  │ │ KG构建器 │ │ 报告生成 │ │ 待办提取 │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│              PostgreSQL 16 + pgvector                            │
│  22+ 张表 │ 1024 维向量索引 │ JSONB 扩展字段 │ 行级权限过滤      │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 数据流

```
飞书数据源 (Bitable/云文档/日历/聊天)
        ↓
ETL 管道: 抽取 → LLM Schema 映射 → 增量同步
        ↓                              ↑
本地上传 (PDF/DOCX/音频/图片/CSV)   缓存映射结果
        ↓
智能数据处理 (提取规则引擎 + 清洗规则引擎)
        ↓
标准化资产 (Document / Communication / StructuredTable)
  ├── 文本向量化 (BAAI/bge-m3, 1024维)
  ├── LLM 增强 (关键词/情感/质量评分/关键信息提取)
  ├── 自动标签 (ContentTag)
  └── 实体关系抽取 (KGEntity + KGRelation)
        ↓
混合 RAG 检索 (Vector + BM25 + RRF + Graph-RAG)
        ↓
数据应用层 (问答/报告/洞察/待办/日程 — 探索中)
        ↓
SSE 流式输出 → 前端实时渲染
```

---

## 3. 功能模块详述

### 3.1 统一身份认证与权限控制

#### 3.1.1 飞书 SSO 登录
- 前端引导用户进行飞书 OAuth 2.0 授权
- 后端通过临时 `code` 换取 `user_access_token`，获取 `feishu_open_id` 并绑定用户
- 签发 JWT Token（HS256, 24h 有效期）
- 登录时自动触发全量同步（ETL + 云文档 + 待办 + 结构化表格）

#### 3.1.2 角色与权限
| 角色 | 数据可见范围 | 系统权限 |
|------|-------------|----------|
| employee | 个人数据 + UserVisibilityOverride（直接共享）+ UserDeptSharing（部门共享） | 基础功能 |
| admin | 全局数据 | ETL 管理、用户管理、系统配置 |

#### 3.1.3 行级安全 (RLS)
- 所有内容查询通过 `get_visible_owner_ids()` 依赖注入
- 计算逻辑：自有数据 + 直接授权用户 + 部门共享数据
- 管理员绕过所有过滤
- 系统管理员 (`SUPER_ADMIN_OPEN_ID`) 不可变更

### 3.2 数据采集模块

#### 3.2.1 ETL 自动化管道
- **注册中心寻址**：从飞书多维表格读取 `ETLDataSource` 配置
- **增量拉取**：按 `last_sync_time` 过滤，仅抓取新增/更新记录
- **LLM Schema 映射**：将源表字段语义对齐到标准 Schema，结果按 MD5 缓存
- **数据增强**：自动提取关键词、情感分析、质量评分、关键信息
- **向量化**：生成 1024 维文本向量用于 RAG 检索
- **知识图谱**：自动提取实体和关系
- **标签继承**：从数据源继承 `default_tag_ids`
- **Upsert 入库**：基于 `content_hash` 去重，避免重复数据
- **异常告警**：失败时通过飞书 Webhook 发送告警卡片

#### 3.2.2 本地文件上传
- **支持格式**：PDF、DOCX、TXT、CSV、XLSX、图片（JPG/PNG）、音频（MP3/WAV/M4A）
- **智能解析**：
  - 文档类：PyPDF/python-docx 提取文本 → LLM 解析
  - 图片类：视觉模型（Qwen3-VL）提取内容
  - 音频类：ASR（FunASR）语音转文字 → LLM 解析
- **自定义提取规则**：支持用户定义 Prompt 模板，提取特定关键信息字段
- **手动标签**：上传时可指定标签

#### 3.2.3 飞书云文档同步
- **云文件夹订阅**：用户配置 `CloudFolderSource`，递归遍历文件夹
- **云文档导入**：自动获取文档内容，按内容哈希去重
- **关键词匹配规则**：`KeywordSyncRule` 自动匹配并导入符合条件的文档

#### 3.2.4 结构化表格导入
- **多来源支持**：
  - 飞书 Bitable（多维表格）
  - 飞书 Spreadsheet（电子表格）
  - 本地 CSV/Excel 上传
  - URL 导入（自动解析飞书链接）
- **数据清洗规则**：`CleaningRule` 支持正则/映射转换
- **全文搜索**：支持跨行数据检索

### 3.3 数据提取与清洗规则（核心能力）

#### 3.3.1 提取规则引擎 (ExtractionRule)

用于非结构化数据（文档/沟通记录）的关键信息自动提取，是平台数据处理的核心差异化能力。

- **行业板块模板**：内置 4 大行业模板
  - **能源**：装机容量、投资金额、项目阶段、合作方、风险事项
  - **城乡**：区域地块、规划指标、审批进展、政策依据
  - **不良资产**：资产类型、本金金额、处置方式、法律进展、尽调发现
  - **其他**：关键指标、时间节点、相关方、问题建议
- **通用字段**：项目名称、关键决策、行动项、负责人
- **自定义字段**：用户可自定义提取字段和 Prompt 提示
- **规则绑定**：可绑定到 ETL 数据源 (`ETLDataSource.extraction_rule_id`) 和云文件夹 (`CloudFolderSource.extraction_rule_id`)
- **提取结果**：存入 Document/Communication 的 `key_info` (JSONB) 字段，前端以紫色高亮卡片展示

#### 3.3.2 清洗规则引擎 (CleaningRule)

用于结构化表格数据的自动清洗与标准化，确保入库数据质量。

- **7 种清洗选项**：
  - `dedup`：去除重复行
  - `drop_empty_rows`：丢弃空行（可配置空值阈值）
  - `normalize_dates`：日期格式统一
  - `normalize_numbers`：数值格式标准化
  - `trim_whitespace`：去除首尾空白
  - `llm_field_merge`：LLM 智能字段合并
  - `llm_field_clean`：LLM 智能字段清洗
- **字段提示**：`field_hint` 描述目标字段语义，辅助 LLM 清洗
- **自动应用**：结构化表格导入后自动应用已激活的清洗规则

### 3.4 三大核心内容表

| 内容类型 | 表名 | 来源 | 核心字段 |
|----------|------|------|----------|
| 文档资产 | Document | 飞书同步/本地上传 | title, content_text, content_vector, keywords, sentiment, key_info, doc_category |
| 沟通记录 | Communication | 会议/聊天/录音 | comm_type (meeting/chat/recording), participants, agenda, conclusions, action_items, duration |
| 结构化表格 | StructuredTable + Row | Bitable/Spreadsheet/CSV | column_schema, row_data, cleaning_applied |

**共有字段**：`owner_id`（权限锚点）、`content_vector`（1024 维）、通过 `ContentTag` 关联标签、通过 `ContentEntityLink` 关联知识图谱实体。

> 注：Communication 表统一了旧的 Meeting 和 ChatMessage 表，通过 `comm_type` 字段区分会议 (meeting)、聊天 (chat) 和录音 (recording) 三种类型。

### 3.5 标签系统

#### 3.5.1 标签定义 (TagDefinition)
- **四大类别**：project（项目）、priority（优先级）、topic（主题）、custom（自定义）
- **属性**：名称、颜色（8 种预设色）、是否共享
- **权限**：个人标签 + 共享标签 + 系统标签均可见

#### 3.5.2 内容标签 (ContentTag)
- **标记方式**：user_manual（手动）、source_inherit（数据源继承）、ai_suggest（AI 推荐）
- **操作**：单条标记/批量标记/移除标记
- **交互**：标签芯片可点击，跳转至 `/search?tag_ids={id}` 全局筛选

### 3.6 人物画像

- **数据来源**：知识图谱实体 (KGEntity) + 关联关系 (KGRelation)
- **画像内容**：
  - 基本信息：姓名、实体类型、被提及次数
  - 协作者列表：与该人物有 `collaborates_with` 关系的其他人物，按权重排序
  - 关联事项：与该人物相关的项目/事务实体 (`involved_in`, `related_to`)
- **查询方式**：
  - 按实体 ID 查询：`GET /api/profile/by-entity/{entity_id}`
  - 按姓名模糊查询：`GET /api/profile/by-name?name={query}`
- **展示组件**：`PersonProfileWidget` 小组件，内嵌在日程管家、知识图谱等页面中，支持搜索和雷达图展示

### 3.7 知识图谱

#### 3.7.1 图谱构建 (KGBuilder)
- **实体类型**：person（人物）、project（项目）、department（部门）等
- **关系类型**：collaborates_with、involved_in、related_to
- **构建模式**：增量构建 / 全量重建
- **异步执行**：后台任务，支持进度查询和取消

#### 3.7.2 图谱分析 (KGAnalyzer)
- **社区发现**：Louvain 算法检测社区集群
- **LLM 洞察**：基于社区结构生成自然语言洞察
- **风险预警**：识别异常模式（高/中/低严重度），附带证据和建议
- **中心性指标**：计算节点重要性评分

#### 3.7.3 图谱可视化
- **D3 力导向图**：节点按实体类型着色，边表示关系
- **交互能力**：缩放/平移/点击聚焦/下载 PNG
- **社区视图**：按集群分组显示
- **实体详情侧边栏**：属性编辑、关联资产浏览

#### 3.7.4 内容-实体关联 (ContentEntityLink)
- 每条内容自动关联被提及的实体
- 支持双向查询：内容→实体、实体→内容
- 上下文片段保存，显示实体在内容中的出现位置

### 3.8 数据共享

#### 3.8.1 用户级共享 (UserVisibilityOverride)
- 直接将个人数据授权给指定用户

#### 3.8.2 部门级共享 (UserDeptSharing)
- 将个人数据授权给整个部门
- 部门树形结构（可搜索）

#### 3.8.3 共享可见性
- 查看"谁共享了数据给我"
- 查看"我共享了数据给谁"

### 3.9 智能应用层（探索中）

> 以下功能基于平台沉淀的结构化数据资产构建，目前处于持续优化阶段，不作为核心卖点。

#### 3.9.1 智能问答助手（流光）
- **混合 RAG 检索**：Vector 余弦相似度 + BM25 关键词检索 + RRF 融合 + Graph-RAG 增强
- **对话功能**：SSE 流式输出、会话管理、来源引用、附件解析、快捷模板
- **权限过滤**：所有检索结果均经过 RLS 过滤

#### 3.9.2 报告生成
- **模板系统**：系统模板 + 自定义模板（`ReportTemplate`）
- **SSE 流式生成**：实时渲染 Markdown 报告内容
- **发布到飞书**：一键推送为飞书云文档

#### 3.9.3 日程管家
- **日历事件**：从飞书日历获取近期日程，按日分组展示
- **会议简报**：LLM 综合相关文档/消息生成会议准备简报
- **参会人画像**：展示参会人的知识图谱信息

#### 3.9.4 智能待办
- **AI 提取**：从近期会议/聊天记录中自动提取待办事项
- **状态管理**：待确认 → 进行中 → 已完成 / 已忽略
- **来源追溯**：关联到原始会议/沟通记录

#### 3.9.5 个人数据资产评分
- **五维评估**：完整性、时效性、质量、可访问性、治理
- **等级评定**：卓越 / 优秀 / 良好 / 待提升
- **雷达图可视化**：直观展示各维度得分

---

## 4. 页面与交互设计

### 4.1 路由结构

| 路径 | 页面 | 功能 |
|------|------|------|
| `/login` | 登录页 | 飞书 OAuth 回调 |
| `/data-insights` | 数据洞察看板 | 统计卡片、资产评分、待办、知识图谱 |
| `/data-import` | 数据导入 | 本地上传 + 飞书云同步 + 数据规则 |
| `/documents` | 文档资产 | 表格视图、搜索/过滤、标签管理、详情侧栏 |
| `/communications` | 沟通记录 | 会议+聊天统一视图、类型切换 |
| `/structured-tables` | 结构化表格 | 表格列表、Schema 查看、行浏览 |
| `/chat?tab=chat` | 智能问答 | 对话列表、流式回答、来源引用 |
| `/chat?tab=calendar` | 日程管家 | 日历事件、会议简报 |
| `/chat?tab=todos` | 智能待办 | AI 提取、状态管理 |
| `/chat?tab=reports` | 报告生成 | 模板选择、流式生成、飞书推送 |
| `/chat?tab=graph` | 数据图谱 | 知识图谱可视化、社区、洞察 |
| `/search` | 全局搜索 | 跨内容类型搜索 + 标签管理 |
| `/settings` | 系统设置 | 权限/标签/通知/ETL 管理 |
| `/reports/:id` | 报告详情 | Markdown 编辑/预览、飞书推送 |

### 4.2 核心交互模式

#### 数据互联导航
- **实体可点击**：人名 → 知识图谱人物画像，项目名 → 图谱项目视图
- **URL 深度链接**：`?tab=`（标签切换）、`?highlight={id}`（高亮定位）、`?entity={type}:{name}`（聚焦实体）
- **全局搜索 (Ctrl+K)**：跨文档/沟通/表格/实体统一搜索
- **来源引用可点击**：AI 回答中的引用链接跳转至原始内容
- **标签芯片可点击**：跳转至按标签筛选的搜索结果

#### 表格管理
- 可配置列显示/隐藏（LocalStorage 持久化）
- 行选择 + 批量操作（标签/删除）
- 跨页导航高亮（URL 参数 `?highlight={id}`）
- 20 条/页分页

#### 侧边栏模式
- 右滑详情面板（文档/沟通详情）
- 左侧导航栏（移动端可折叠）
- 左侧会话/报告列表（Chat 页面）
- 右侧知识图谱实体面板（Chat 页面）

### 4.3 设计规范

| 元素 | 规范 |
|------|------|
| 主色 | Indigo-600 (`#4f46e5`) |
| 品牌渐变 | `from-indigo-500 to-purple-600` |
| 卡片 | `bg-white rounded-xl shadow-sm border border-gray-200 p-5` |
| 按钮 | `px-4 py-2 rounded-lg text-sm font-medium transition-colors` |
| 输入框 | `bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-200` |
| 状态色 | 绿色=成功，红色=错误，橙色=警告，蓝色=进行中，紫色=知识图谱 |
| 圆角 | 小元素 8px, 卡片 12px, 弹窗 16px |
| 响应式 | Mobile-first，`lg:` 断点切换桌面布局 |

---

## 5. API 接口概览

### 5.1 端点分类统计

| 模块 | 端点数 | 核心能力 |
|------|--------|----------|
| 身份认证 | 1 | OAuth + JWT |
| 用户管理 | 3 | 信息查询 + 角色管理 |
| 文档资产 | 5 | CRUD + 批量删除 + 下载 |
| 沟通记录 | 4 | CRUD + 批量删除 |
| 文件上传 | 2 | 文档上传 + 音频上传 |
| 结构化表格 | 7 | 多源导入 + 搜索 + 预览 |
| 智能问答 | 3 | 流式/非流式 QA + 附件解析 |
| 全局搜索 | 1 | 跨内容类型检索 |
| 知识图谱 | 15+ | 构建/分析/查询/配置 |
| 人物画像 | 2 | 按实体 ID / 姓名查询画像 |
| 报告生成 | 7 | 模板 + 生成 + 编辑 + 发布 |
| 提取规则 | 5 | CRUD + 行业模板查询 |
| 清洗规则 | 4 | CRUD |
| ETL 管理 | 9 | 数据源 CRUD + 同步触发 |
| 数据导入 | 4+ | 飞书源管理 + 云文档同步 |
| 标签系统 | 11 | CRUD + 附加/分离 + 批量 |
| 智能待办 | 7 | AI 提取 + CRUD + 批量 |
| 会话管理 | 5 | 创建/列表/导出 |
| 日程管家 | 6 | 事件 + 简报 + 提醒 |
| 系统设置 | 15+ | 共享/通知/云文件夹/关键词规则 |
| 资产统计 | 2 | 统计 + 评分 |
| **合计** | **~110** | |

### 5.2 流式接口（SSE）

| 接口 | 用途 |
|------|------|
| `POST /api/chat/stream` | 智能问答（推理+回答+来源） |
| `POST /api/reports/generate/stream` | 报告流式生成 |
| `POST /api/calendar/brief/stream` | 会议简报流式生成 |

---

## 6. 数据模型

### 6.1 核心表清单（22+ 张）

**内容层**：Document, Communication, StructuredTable, StructuredTableRow, ContentChunk

**用户与权限层**：User, Department, UserDepartment, UserVisibilityOverride, UserDeptSharing

**知识图谱层**：KGEntity, KGRelation, ContentEntityLink, KGProfile, KGAnalysisResult

**标签层**：TagDefinition, ContentTag

**ETL 层**：ETLDataSource, ETLSyncState, SchemaMappingCache, CloudFolderSource, ImportTask

**应用层**：Report, ReportTemplate, Conversation, ConversationMessage, TodoItem, CalendarReminderPref

**数据规则层**：ExtractionRule（提取规则 + 行业模板）, CleaningRule（清洗规则）, KeywordSyncRule（关键词匹配规则）

**配置层**：NotificationPref, LeadershipInsight（画像洞察，内部使用）

### 6.2 向量索引

所有三大内容表均包含 `content_vector` 字段（1024 维，BAAI/bge-m3），通过 pgvector 扩展支持余弦相似度检索。

### 6.3 Communication 表说明

Communication 表统一存储所有沟通类数据，通过 `comm_type` 字段区分类型：

| comm_type | 说明 | 典型来源 |
|-----------|------|----------|
| meeting | 会议纪要 | 飞书日历会议、ETL 同步 |
| chat | 聊天记录 | 飞书群聊、ETL 同步 |
| recording | 录音转写 | 本地音频上传 + ASR |

---

## 7. 后台任务

| 任务 | 触发方式 | 说明 |
|------|----------|------|
| ETL 全量同步 | 用户登录时触发 | 抽取→转换→增强→加载 |
| 云文件夹同步 | 用户登录时触发 | 递归遍历飞书云文件夹 |
| 待办提取 | 用户登录时触发 | 从近期内容中 AI 提取待办 |
| 待办状态同步 | 用户登录时触发 | 与飞书任务状态同步 |
| 结构化表格刷新 | 用户登录时触发 | 更新 Bitable 源数据 |
| 日历提醒 | 每 2 小时定时 | 检查即将到来的会议并发送提醒 |
| 知识图谱构建 | 手动触发 | 后台异步，支持进度查询和取消 |

---

## 8. 部署架构

### Docker Compose 三服务栈

```yaml
postgres:    pgvector/pgvector:pg16  → 端口 5432
backend:     FastAPI + Alembic       → 端口 8000
frontend:    React SPA + Nginx       → 端口 80（/api 反代后端）
```

### 启动流程

1. PostgreSQL 启动并健康检查通过
2. Backend 执行 `alembic upgrade head` 数据库迁移
3. Backend 启动 `uvicorn` 服务
4. Frontend Nginx 启动，代理 `/api` 请求到后端

### 环境变量

- **数据库**：`DATABASE_URL`（asyncpg 连接串）
- **飞书**：`FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_BASE_DOMAIN`
- **JWT**：`JWT_SECRET_KEY`（24h 有效期）
- **LLM**：`LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`（文本模型）
- **Embedding**：`EMBEDDING_*`（向量模型，默认 BAAI/bge-m3, 1024 维）
- **Agent LLM**：`AGENT_LLM_*`（推理模型，可独立配置）
- **Vision**：`VISION_LLM_MODEL`（视觉理解模型）
- **ASR**：`ASR_*`（语音转文字模型）
- **系统**：`SUPER_ADMIN_OPEN_ID`（不可变更的系统管理员）

---

## 9. 项目里程碑

| 阶段 | 内容 | 状态 |
|------|------|------|
| P0 | 工程骨架 + 数据库基础 | 已完成 |
| P1 | 飞书 SSO + RBAC 权限 | 已完成 |
| P2 | ETL 数据抽取 + 增量同步 | 已完成 |
| P3 | LLM 转换 + 资产入库 | 已完成 |
| P4 | 数据处理规则引擎（提取+清洗） | 已完成 |
| P5 | 前端看板 + 完整 UI | 已完成 |
| P6 | 集成测试 + 部署上线 | 已完成 |

**数据库迁移**：47 个版本，覆盖完整的 Schema 演进历程。
