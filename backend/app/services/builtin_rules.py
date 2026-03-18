"""内置提取规则和清洗规则定义。

使用负数 ID 与用户自建规则区分，不存数据库，以代码常量形式定义。
"""

from datetime import datetime

# 固定的时间戳，用于内置规则的 created_at / updated_at
_BUILTIN_TIME = datetime(2024, 1, 1)


# ── 内置提取规则 ──────────────────────────────────────────

BUILTIN_EXTRACTION_RULES = [
    {
        "id": -1,
        "name": "会议纪要提取",
        "sectors": [],
        "fields": [
            {"key": "meeting_topic", "label": "会议主题", "description": "会议的核心议题和主题", "builtin": True, "sector": "custom"},
            {"key": "participants", "label": "参会人员", "description": "参与会议的人员列表", "builtin": True, "sector": "custom"},
            {"key": "key_decisions", "label": "关键决策", "description": "会议中做出的重要决定和结论", "builtin": True, "sector": "custom"},
            {"key": "action_items", "label": "行动项", "description": "待办事项，包含负责人和截止日期", "builtin": True, "sector": "custom"},
            {"key": "open_issues", "label": "遗留问题", "description": "未解决的问题和下次跟进事项", "builtin": True, "sector": "custom"},
        ],
        "prompt_hint": "请以会议纪要视角提取信息，重点关注决策结论和待办事项。每个行动项需明确负责人和截止时间。",
        "is_active": True,
        "is_builtin": True,
        "created_at": _BUILTIN_TIME,
        "updated_at": _BUILTIN_TIME,
    },
    {
        "id": -2,
        "name": "合同协议提取",
        "sectors": [],
        "fields": [
            {"key": "contract_name", "label": "合同名称", "description": "合同或协议的正式名称", "builtin": True, "sector": "custom"},
            {"key": "parties", "label": "甲方/乙方", "description": "合同各方当事人名称", "builtin": True, "sector": "custom"},
            {"key": "amount", "label": "合同金额", "description": "金额数字，含币种和大小写", "builtin": True, "sector": "custom"},
            {"key": "validity_period", "label": "有效期限", "description": "合同起止日期或有效期", "builtin": True, "sector": "custom"},
            {"key": "key_terms", "label": "关键条款", "description": "核心权利义务和特殊约定", "builtin": True, "sector": "custom"},
            {"key": "breach_liability", "label": "违约责任", "description": "违约情形和对应的责任条款", "builtin": True, "sector": "custom"},
        ],
        "prompt_hint": "以法律文书视角提取合同核心要素，注意区分甲乙方、金额需包含币种和大小写。",
        "is_active": True,
        "is_builtin": True,
        "created_at": _BUILTIN_TIME,
        "updated_at": _BUILTIN_TIME,
    },
    {
        "id": -3,
        "name": "聊天记录提取",
        "sectors": [],
        "fields": [
            {"key": "topic_summary", "label": "话题摘要", "description": "对话涉及的主要话题概述", "builtin": True, "sector": "custom"},
            {"key": "key_people", "label": "关键人物", "description": "对话中提到的重要人物及其角色", "builtin": True, "sector": "custom"},
            {"key": "todo_items", "label": "待办事项", "description": "对话中提到需要跟进的事项", "builtin": True, "sector": "custom"},
            {"key": "mentioned_projects", "label": "提及的项目/客户", "description": "对话中涉及的项目名或客户名", "builtin": True, "sector": "custom"},
            {"key": "conclusions", "label": "重要结论", "description": "对话中达成的共识或结论", "builtin": True, "sector": "custom"},
        ],
        "prompt_hint": "从多人对话中提炼业务相关信息，忽略寒暄和无关闲聊，聚焦于工作事项和决策。",
        "is_active": True,
        "is_builtin": True,
        "created_at": _BUILTIN_TIME,
        "updated_at": _BUILTIN_TIME,
    },
    {
        "id": -4,
        "name": "项目报告提取",
        "sectors": [],
        "fields": [
            {"key": "project_name", "label": "项目名称", "description": "报告涉及的项目名称", "builtin": True, "sector": "custom"},
            {"key": "project_phase", "label": "项目阶段", "description": "当前所处阶段（如立项/执行/收尾）", "builtin": True, "sector": "custom"},
            {"key": "progress_summary", "label": "进展概述", "description": "当前进展的简要描述", "builtin": True, "sector": "custom"},
            {"key": "issues_risks", "label": "问题与风险", "description": "遇到的问题、风险及影响评估", "builtin": True, "sector": "custom"},
            {"key": "next_steps", "label": "下步计划", "description": "下一阶段的工作计划和关键节点", "builtin": True, "sector": "custom"},
            {"key": "resource_needs", "label": "资源需求", "description": "需要的人力、资金或其他资源支持", "builtin": True, "sector": "custom"},
        ],
        "prompt_hint": "从项目管理视角提取进展信息，关注里程碑达成、风险预警和资源需求。",
        "is_active": True,
        "is_builtin": True,
        "created_at": _BUILTIN_TIME,
        "updated_at": _BUILTIN_TIME,
    },
    {
        "id": -5,
        "name": "商务洽谈提取",
        "sectors": [],
        "fields": [
            {"key": "negotiation_topic", "label": "洽谈主题", "description": "本次商务洽谈的核心议题", "builtin": True, "sector": "custom"},
            {"key": "deal_stage", "label": "所属阶段", "description": "商机所处阶段（如初步接洽/需求确认/方案报价/商务谈判/签约落地）", "builtin": True, "sector": "custom"},
            {"key": "signing_entity", "label": "签约主体", "description": "预计或已确定的签约公司主体名称", "builtin": True, "sector": "custom"},
            {"key": "client_party", "label": "客户方", "description": "对方公司名称及对接人信息", "builtin": True, "sector": "custom"},
            {"key": "related_opportunity", "label": "关联商机", "description": "关联的商机名称或编号", "builtin": True, "sector": "custom"},
            {"key": "demands", "label": "各方诉求", "description": "各参与方的核心诉求和关注点", "builtin": True, "sector": "custom"},
            {"key": "pricing_terms", "label": "报价/条件", "description": "涉及的价格、条件和商务条款", "builtin": True, "sector": "custom"},
            {"key": "cooperation_intent", "label": "合作意向", "description": "各方对合作的态度和意向程度", "builtin": True, "sector": "custom"},
            {"key": "follow_up", "label": "后续跟进", "description": "下一步行动计划和跟进时间节点", "builtin": True, "sector": "custom"},
        ],
        "prompt_hint": "以商务谈判视角提取信息，重点关注商机阶段、签约主体、客户信息和谈判进展。注意区分己方和对方的立场。",
        "is_active": True,
        "is_builtin": True,
        "created_at": _BUILTIN_TIME,
        "updated_at": _BUILTIN_TIME,
    },
    {
        "id": -6,
        "name": "表格数据提取",
        "sectors": [],
        "fields": [
            {"key": "data_summary", "label": "数据摘要", "description": "表格数据的整体概述和主要内容", "builtin": True, "sector": "custom"},
            {"key": "key_metrics", "label": "关键指标", "description": "重要的数值指标和统计数据", "builtin": True, "sector": "custom"},
            {"key": "anomalies", "label": "异常值", "description": "明显偏离正常范围的数据点", "builtin": True, "sector": "custom"},
            {"key": "trend_analysis", "label": "趋势分析", "description": "数据中可观察到的趋势或规律", "builtin": True, "sector": "custom"},
            {"key": "data_quality", "label": "数据质量", "description": "缺失值、重复值等数据质量问题", "builtin": True, "sector": "custom"},
        ],
        "prompt_hint": "分析表格的整体结构和数据特征，提取关键统计信息和数据洞察，而非逐行提取。",
        "is_active": True,
        "is_builtin": True,
        "created_at": _BUILTIN_TIME,
        "updated_at": _BUILTIN_TIME,
    },
]


# ── 内置清洗规则 ──────────────────────────────────────────

BUILTIN_CLEANING_RULES = [
    {
        "id": -1,
        "name": "基础清洗",
        "options": {
            "dedup": True,
            "drop_empty_rows": True,
            "empty_threshold": 0.8,
            "trim_whitespace": True,
            "normalize_dates": False,
            "normalize_numbers": False,
            "llm_field_merge": False,
            "llm_field_clean": False,
        },
        "field_hint": "",
        "is_active": True,
        "is_builtin": True,
        "created_at": _BUILTIN_TIME,
        "updated_at": _BUILTIN_TIME,
    },
    {
        "id": -2,
        "name": "标准清洗",
        "options": {
            "dedup": True,
            "drop_empty_rows": True,
            "empty_threshold": 0.5,
            "trim_whitespace": True,
            "normalize_dates": True,
            "normalize_numbers": True,
            "llm_field_merge": False,
            "llm_field_clean": False,
        },
        "field_hint": "",
        "is_active": True,
        "is_builtin": True,
        "created_at": _BUILTIN_TIME,
        "updated_at": _BUILTIN_TIME,
    },
    {
        "id": -3,
        "name": "深度清洗",
        "options": {
            "dedup": True,
            "drop_empty_rows": True,
            "empty_threshold": 0.5,
            "trim_whitespace": True,
            "normalize_dates": True,
            "normalize_numbers": True,
            "llm_field_merge": True,
            "llm_field_clean": True,
        },
        "field_hint": "请智能识别可合并的同义列，自动纠正拼写错误，统一同一字段的不同表述方式。",
        "is_active": True,
        "is_builtin": True,
        "created_at": _BUILTIN_TIME,
        "updated_at": _BUILTIN_TIME,
    },
]


def get_builtin_extraction_rule(rule_id: int) -> dict | None:
    """根据负数 ID 获取内置提取规则。"""
    for rule in BUILTIN_EXTRACTION_RULES:
        if rule["id"] == rule_id:
            return rule
    return None


def get_builtin_cleaning_rule(rule_id: int) -> dict | None:
    """根据负数 ID 获取内置清洗规则。"""
    for rule in BUILTIN_CLEANING_RULES:
        if rule["id"] == rule_id:
            return rule
    return None
