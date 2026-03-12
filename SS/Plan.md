# 流光数据中台 — 开发计划

> **产品名称**：流光数据中台
> **更新日期**：2026-03-12
> **状态**：P0-P6 已全部完成，进入持续优化阶段

---

## 已完成阶段总览

| 阶段 | 名称 | 状态 |
|------|------|------|
| P0 | 工程骨架与数据库底座 | 已完成 |
| P1 | 飞书 SSO 鉴权与 RBAC 权限 | 已完成 |
| P2 | ETL 引擎 — 多源数据采集 | 已完成 |
| P3 | LLM 智能清洗与资产入库 | 已完成 |
| P4 | 混合 RAG 检索与智能问答 | 已完成 |
| P5 | 前端 17 页面完整 UI | 已完成 |
| P6 | Docker 部署与上线 | 已完成 |

**项目规模**：22 个 ORM 模型 / 24 个 API 路由文件 / ~110 个 API 端点 / 47 个 Alembic 迁移版本 / 17 个前端页面

---

## 各阶段交付成果

### P0 — 工程骨架与数据库底座

- FastAPI + SQLAlchemy 2.0 async 后端骨架
- PostgreSQL 16 + pgvector 扩展
- Alembic 异步迁移体系
- Pydantic Settings 配置管理

### P1 — 飞书 SSO 鉴权与 RBAC 权限

- 飞书 OAuth 2.0 SSO 完整登录流程
- JWT HS256 签发/验证（24h 有效期）
- 行级数据隔离（RLS）：get_visible_owner_ids()
- 三级可见性：个人 + 用户共享（UserVisibilityOverride）+ 部门共享（UserDeptSharing）
- 超级管理员保护（SUPER_ADMIN_OPEN_ID）

### P2 — ETL 引擎 — 多源数据采集

- 7 步 ETL 管道：Preprocessor → Extractor → Transformer → Enricher → Postprocessor → Loader → KGBuilder
- 飞书 Bitable 增量同步（基于 last_sync_time）
- LLM Schema 智能映射（MD5 缓存避免重复调用）
- 本地文件上传：PDF / DOCX / TXT / CSV / XLSX / 图片 / 音频
- 飞书云文档同步：文件夹递归遍历 + 关键词匹配
- 结构化表格导入：Bitable / Spreadsheet / CSV / URL
- 飞书 API 频次控制（QPS≤5）+ 指数退避重试

### P3 — LLM 智能清洗与资产入库

- 提取规则引擎（ExtractionRule）：4 大行业模板（能源 / 城乡 / 不良资产 / 其他）+ 自定义 Prompt
- 清洗规则引擎（CleaningRule）：7 种清洗选项（去重 / 丢弃空行 / 日期标准化 / 数值标准化 / 去空白 / LLM 字段合并 / LLM 字段清洗）
- 内容增强：一次 LLM 调用提取摘要 / 关键词 / 情感 / 分类
- 向量化：BAAI/bge-m3 1024 维嵌入
- 内容哈希去重 + Upsert 入库
- 飞书 Webhook 异常告警

### P4 — 混合 RAG 检索与智能问答

- 混合 RAG：Vector 余弦相似度 + BM25 关键词 + RRF 融合
- Graph-RAG 增强：查询实体提取 → 知识图谱上下文补充
- 权限感知检索：所有结果经 RLS 过滤
- SSE 流式输出：推理过程 + 回答 + 来源引用
- 会话管理：创建 / 列表 / 详情 / 删除 / 导出

### P5 — 前端 17 页面完整 UI

- React 19 + TypeScript + Vite 7 + Tailwind CSS 4
- TanStack React Query 服务端状态管理
- 17 个页面：DataInsights / DataImport / Documents / Communications / StructuredTables / Chat（5 个 tab）/ Search / Settings / Reports / ReportDetail / Todos / KnowledgeGraph / LeadershipInsight / DepartmentAdmin / ETLAdmin / CalendarAssistant / Login
- 全局搜索（Ctrl+K）跨内容类型
- 可配置列显示 + 批量操作 + 标签系统
- D3 知识图谱可视化
- Framer Motion 页面动画

### P6 — Docker 部署与上线

- Docker Compose 三服务栈（PostgreSQL + Backend + Nginx）
- build-and-deploy.sh 自动化部署脚本
- 47 个 Alembic 迁移版本

---

## 后续优化方向（探索中）

| 方向 | 说明 | 优先级 |
|------|------|--------|
| 数据处理规则增强 | 更多行业模板、更智能的清洗策略 | P0 |
| ETL 管道稳定性 | 错误恢复、断点续传、批量调度 | P0 |
| AI 问答质量 | RAG 检索优化、Prompt 调优、多轮对话 | P1 |
| 知识图谱丰富 | 更多实体类型、关系权重、时序分析 | P1 |
| 性能优化 | 大数据量下的查询优化、缓存策略 | P1 |
| 报告生成 | 更多模板、更好的格式化、自动发布 | P2 |
| 日程管家 | 飞书日历深度集成、智能提醒 | P2 |
| 智能待办 | 提取准确率提升、飞书任务双向同步 | P2 |
| 无障碍访问 | 按钮标签、表单标签等 a11y 修复 | P2 |
