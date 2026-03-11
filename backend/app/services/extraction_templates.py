"""内置板块提取字段模板。"""

SECTOR_TEMPLATES: dict[str, list[dict]] = {
    "common": [
        {"key": "project_name", "label": "项目名称", "description": "提取文中涉及的项目名称"},
        {"key": "decision_points", "label": "关键决策", "description": "重要的决策内容和结论"},
        {"key": "action_items", "label": "行动项", "description": "需要执行的任务和待办事项"},
        {"key": "responsible_person", "label": "负责人", "description": "相关的负责人和参与者"},
    ],
    "energy": [
        {"key": "capacity", "label": "装机容量/规模", "description": "能源项目的装机容量或规模信息"},
        {"key": "investment", "label": "投资金额", "description": "项目投资额度和资金信息"},
        {"key": "project_phase", "label": "项目阶段", "description": "前期/建设/运营等阶段"},
        {"key": "partner", "label": "合作方/业主方", "description": "项目合作伙伴和业主信息"},
        {"key": "risk_items", "label": "风险事项", "description": "项目风险和注意事项"},
    ],
    "urban": [
        {"key": "region", "label": "区域/地块", "description": "涉及的地理区域或地块信息"},
        {"key": "planning_index", "label": "规划指标", "description": "容积率、面积等规划指标"},
        {"key": "approval_progress", "label": "审批进展", "description": "相关审批手续的进展状态"},
        {"key": "policy_basis", "label": "政策依据", "description": "相关的政策文件和依据"},
    ],
    "npa": [
        {"key": "asset_type", "label": "资产类型", "description": "债权/物权等资产分类"},
        {"key": "principal_amount", "label": "本金/金额", "description": "资产包的本金或金额"},
        {"key": "disposal_method", "label": "处置方式", "description": "资产的处置方案"},
        {"key": "legal_progress", "label": "法律进展", "description": "相关法律程序进展"},
        {"key": "due_diligence", "label": "尽调发现", "description": "尽职调查的关键发现"},
    ],
    "other": [
        {"key": "key_metrics", "label": "关键数据/指标", "description": "文中提到的重要数据和指标"},
        {"key": "timeline", "label": "时间节点", "description": "关键时间节点和截止日期"},
        {"key": "stakeholders", "label": "相关方", "description": "涉及的组织、部门或人员"},
        {"key": "issues", "label": "问题与建议", "description": "提出的问题和建议事项"},
    ],
}

SECTOR_LABELS: dict[str, str] = {
    "energy": "能源",
    "urban": "城乡",
    "npa": "不良资产",
    "other": "其他",
}


def get_template_fields(sectors: list[str]) -> list[dict]:
    """根据选择的板块生成合并后的字段列表。"""
    fields = []
    for f in SECTOR_TEMPLATES["common"]:
        fields.append({**f, "builtin": True, "sector": "common"})
    for sector in sectors:
        for f in SECTOR_TEMPLATES.get(sector, []):
            fields.append({**f, "builtin": True, "sector": sector})
    return fields
