# 个人数据资产归档评分 — 设计文档

## 概述

在数据洞察页面新增"个人数据资产归档评分"功能，类似360安全卫士电脑评分。提供综合评分+雷达图展示，每个低分维度提供可操作的优化按钮。

## 评分维度（7项，平均权重）

| 维度 | key | 计算方式 | 低分优化动作 |
|------|-----|---------|------------|
| 数据量 | volume | 文档+沟通+表格总数，对数曲线映射到0~100 | → 跳转数据导入页 |
| 数据质量 | quality | 所有内容平均 quality_score × 100 | → 触发重新分析 |
| 知识图谱 | knowledge | 实体数+关系数，对数曲线映射 | → 触发KG构建 |
| 标签覆盖 | tags | 已标签内容数 / 总内容数 × 100 | → 跳转标签设置 |
| 活跃度 | activity | 近30天新增 / 总量比例映射 | → 跳转同步页 |
| AI可搜索率 | vectorization | 有向量内容数 / 总内容数 × 100 | → 触发重新向量化 |
| 数据源激活 | sources | 已激活类型数 / 3 × 100 | → 跳转设置页开启 |

总分 = 7个维度平均分

## 等级划分

| 分数区间 | 等级 | 颜色 |
|---------|------|------|
| 90-100 | 卓越 | emerald-500 |
| 70-89 | 优秀 | indigo-500 |
| 50-69 | 良好 | amber-500 |
| 0-49 | 待提升 | red-500 |

## 阈值映射

### 数据量（对数曲线）
- 0条 → 0分, 10条 → 30分, 50条 → 60分, 100条 → 80分, 200条 → 90分, 500+ → 100分
- 公式: min(100, log(count+1) / log(501) * 100)

### 知识图谱
- 实体+关系总数，同样使用对数曲线
- 0 → 0分, 10 → 30分, 50 → 60分, 200+ → 100分

### 活跃度
- 近30天新增占总量比例: 0% → 0分, 30%+ → 100分, 线性插值

### 数据源激活
- 检查3种asset_type（document, communication, structured）是否各有至少1个enabled的ETLDataSource
- 3/3=100, 2/3=67, 1/3=33, 0/3=0

## 后端 API

### GET /api/assets/score

返回结构:
```json
{
  "total_score": 82,
  "level": "优秀",
  "dimensions": [
    {
      "key": "volume",
      "label": "数据量",
      "score": 85,
      "detail": "共 156 条数据资产",
      "action": { "label": "去导入数据", "route": "/documents" }
    }
  ]
}
```

action 规则: score < 70 时返回 action，否则为 null。

## 前端组件

### AssetScoreWidget
- 注册到 widget 系统（useWidgetConfig）
- 使用 WidgetContainer 包裹
- 使用 Recharts RadarChart 绘制雷达图
- 低分维度显示"去优化"按钮，点击 navigate 到对应路由
- 放在 DataInsights 页面统计卡片下方

## 优化动作路由映射

| 维度 | 路由 |
|------|------|
| volume | /documents（数据导入标签页） |
| quality | 触发 POST /api/assets/reprocess（暂不实现，仅提示） |
| knowledge | 触发 POST /knowledge-graph/build-and-analyze |
| tags | /settings?tab=tags |
| activity | /documents（飞书同步标签页） |
| vectorization | 触发 POST /api/assets/reprocess（暂不实现，仅提示） |
| sources | /settings?tab=etl |
