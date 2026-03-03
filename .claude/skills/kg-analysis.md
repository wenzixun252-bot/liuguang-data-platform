# Knowledge Graph Analysis Skill

## Description
对任意非结构化数据执行知识图谱构建、社群检测和智能洞察分析。

## Trigger
当用户要求对数据进行知识图谱分析、社群发现、关系挖掘、风险检测时触发。
触发词："知识图谱分析"、"社群检测"、"关系分析"、"图谱洞察"、"analyze knowledge graph"、"community detection"

## Instructions

### 1. 图谱构建
调用后端 API 触发知识图谱构建：
```
POST /api/knowledge-graph/build?incremental=true
```
这会从已导入的文档中通过 LLM 提取实体（人物、项目、主题、组织、事件、文档）和关系（合作、参与、讨论、隶属、关联），存入 `kg_entities` 和 `kg_relations` 表。

### 2. 图谱分析
调用分析端点运行完整分析流程：
```
POST /api/knowledge-graph/analyze
```
分析包括：
- **社群检测**：使用 Louvain 算法对实体进行社群聚类，写入 `community_id`
- **指标计算**：度中心性（连接最多的节点）、介数中心性（关键桥梁）、项目热度、孤立节点
- **风险检测**：单点依赖风险、孤立节点、社群断裂（信息孤岛）
- **LLM 总结**：将算法指标打包给 LLM 生成自然语言洞察和建议

### 3. 查看结果
- 社群列表：`GET /api/knowledge-graph/communities`
- 洞察结果：`GET /api/knowledge-graph/insights`
- 风险预警：`GET /api/knowledge-graph/risks`
- 实体关联资产：`GET /api/knowledge-graph/entities/{id}/linked-assets`

### 4. 前端可视化
前端知识图谱页面（`/knowledge-graph`）提供：
- D3-force 力导向图谱，支持拖拽、缩放、平移
- 按类型或社群着色切换
- 悬停高亮关联节点
- 右侧面板：实体详情、洞察卡片、风险预警
- 点击洞察/风险卡片高亮相关实体

### 关键文件
- 模型：`backend/app/models/knowledge_graph.py`
- 分析服务：`backend/app/services/kg_analyzer.py`（社群检测、指标、风险、LLM 总结）
- 构建服务：`backend/app/services/kg_builder.py`（实体/关系提取）
- API 端点：`backend/app/api/knowledge_graph.py`
- 前端页面：`frontend/src/pages/KnowledgeGraph.tsx`

### 依赖
- Python: `networkx>=3.0`（图论算法）、`openai`（LLM 调用）
- Frontend: `d3`（力导向图渲染）

### 性能保护
- 实体超过 500 个时只取 top-500（按 mention_count 排序）做分析
- 社群检测使用固定 seed=42 保证结果可复现
