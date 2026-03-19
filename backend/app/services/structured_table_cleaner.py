"""结构化表格数据清洗服务。"""

import hashlib
import json
import logging
import re
from datetime import datetime

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.cleaning_rule import CleaningRule
from app.models.structured_table import StructuredTable, StructuredTableRow

logger = logging.getLogger(__name__)


async def apply_cleaning_rule(
    db: AsyncSession,
    table_id: int,
    rule: CleaningRule,
) -> dict:
    """对表格应用清洗规则。

    流程：
    1. 加载表的 schema_info + 所有 rows
    2. 规则化清洗（按 options 开关）
    3. LLM 智能清洗（如果开启）
    4. 更新数据
    """
    # 加载表和行数据
    table = await db.get(StructuredTable, table_id)
    if not table:
        return {"error": "表格不存在"}

    result = await db.execute(
        select(StructuredTableRow)
        .where(StructuredTableRow.table_id == table_id)
        .order_by(StructuredTableRow.row_index)
    )
    rows = result.scalars().all()

    if not rows:
        return {"rows_before": 0, "rows_after": 0, "fields_before": 0, "fields_after": 0}

    opts = rule.options or {}
    rows_data = [r.row_data for r in rows]
    all_fields = list(rows_data[0].keys()) if rows_data else []
    stats = {
        "rows_before": len(rows_data),
        "fields_before": len(all_fields),
        "llm_actions": [],
    }

    # --- 规则化清洗 ---

    # 1. trim_whitespace
    if opts.get("trim_whitespace", True):
        for rd in rows_data:
            for k, v in rd.items():
                if isinstance(v, str):
                    rd[k] = v.strip()

    # 2. normalize_dates
    if opts.get("normalize_dates", True):
        date_patterns = [
            (r"(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})", r"\1-\2-\3"),
            (r"(\d{4})年(\d{1,2})月(\d{1,2})日?", r"\1-\2-\3"),
        ]
        for rd in rows_data:
            for k, v in rd.items():
                if isinstance(v, str):
                    for pat, repl in date_patterns:
                        if re.search(pat, v):
                            v = re.sub(pat, repl, v)
                            # 补零
                            try:
                                parts = v.split("-")
                                if len(parts) == 3:
                                    v = f"{parts[0]}-{int(parts[1]):02d}-{int(parts[2]):02d}"
                            except (ValueError, IndexError):
                                pass
                            rd[k] = v
                            break

    # 3. normalize_numbers
    if opts.get("normalize_numbers", True):
        num_suffix_pattern = re.compile(r"^([\d,.]+)\s*(万元|万|元|亿|%|％)?\s*$")
        for rd in rows_data:
            for k, v in rd.items():
                if isinstance(v, str):
                    m = num_suffix_pattern.match(v.strip())
                    if m:
                        num_str = m.group(1).replace(",", "")
                        try:
                            float(num_str)
                            rd[k] = num_str
                        except ValueError:
                            pass

    # 4. drop_empty_rows — 只删除全空或接近全空的行
    if opts.get("drop_empty_rows", True):
        threshold = opts.get("empty_threshold", 0.5)
        filtered = []
        for rd in rows_data:
            total = len(rd)
            if total == 0:
                filtered.append(rd)
                continue
            non_empty_count = sum(
                1 for v in rd.values()
                if v is not None and not (isinstance(v, str) and v.strip() == "")
            )
            empty_ratio = 1 - (non_empty_count / total)
            # 保留有至少 1 个非空值的行（安全兜底），同时尊重阈值
            if non_empty_count >= 1 and empty_ratio < threshold:
                filtered.append(rd)
            elif non_empty_count >= 2:
                # 即使超过阈值，有 2 个以上非空值的行仍然保留
                filtered.append(rd)
        rows_data = filtered

    # 5. dedup
    if opts.get("dedup", True):
        seen = set()
        deduped = []
        for rd in rows_data:
            h = hashlib.md5(json.dumps(rd, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
            if h not in seen:
                seen.add(h)
                deduped.append(rd)
        rows_data = deduped

    # --- LLM 智能清洗 ---
    fields_to_drop = []
    fields_to_rename = {}

    if (opts.get("llm_field_merge", True) or opts.get("llm_field_clean", True)) and rule.field_hint:
        try:
            sample = rows_data[:5]
            current_fields = list(sample[0].keys()) if sample else all_fields
            prompt = f"""你是一个数据清洗助手。以下是一个表格的字段列表和前几行样本数据：

字段: {json.dumps(current_fields, ensure_ascii=False)}
样本数据: {json.dumps(sample, ensure_ascii=False)}

用户的清洗要求: {rule.field_hint}

请根据用户要求，返回一个 JSON 对象，包含以下操作：
{{
  "drop_fields": ["要删除的字段名"],
  "rename_fields": {{"旧字段名": "新字段名"}},
  "merge_fields": [{{"sources": ["字段1", "字段2"], "target": "合并后字段名", "separator": ", "}}]
}}

只返回 JSON，不要其他文字。如果不需要某个操作，返回空数组/对象。"""

            from app.services.llm import llm_client

            llm_response = await llm_client.chat_client.chat.completions.create(
                model=settings.llm_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,
            )
            response_text = llm_response.choices[0].message.content.strip()

            # 提取 JSON（可能包含 markdown 代码块）
            if "```" in response_text:
                response_text = response_text.split("```")[1]
                if response_text.startswith("json"):
                    response_text = response_text[4:]
                response_text = response_text.strip()

            json_match = re.search(r"\{[\s\S]*\}", response_text)
            if json_match:
                actions = json.loads(json_match.group())
                stats["llm_actions"] = actions

                # 执行合并
                for merge in actions.get("merge_fields", []):
                    sources = merge.get("sources", [])
                    target = merge.get("target", "")
                    sep = merge.get("separator", ", ")
                    if sources and target:
                        for rd in rows_data:
                            vals = [str(rd.get(s, "")) for s in sources if rd.get(s)]
                            rd[target] = sep.join(vals)
                            for s in sources:
                                if s != target and s in rd:
                                    del rd[s]

                # 执行重命名
                for old_name, new_name in actions.get("rename_fields", {}).items():
                    fields_to_rename[old_name] = new_name
                    for rd in rows_data:
                        if old_name in rd:
                            rd[new_name] = rd.pop(old_name)

                # 执行删除
                for field in actions.get("drop_fields", []):
                    fields_to_drop.append(field)
                    for rd in rows_data:
                        rd.pop(field, None)

        except Exception as e:
            logger.warning("LLM 清洗失败，跳过: %s", e)

    # --- 更新数据库 ---

    # 删除旧行
    await db.execute(
        delete(StructuredTableRow).where(StructuredTableRow.table_id == table_id)
    )

    # 插入清洗后的行
    for i, rd in enumerate(rows_data):
        row_text = " | ".join(f"{k}: {v}" for k, v in rd.items() if v)
        new_row = StructuredTableRow(
            table_id=table_id,
            row_index=i,
            row_data=rd,
            row_text=row_text,
        )
        db.add(new_row)

    # 更新表级元数据
    final_fields = list(rows_data[0].keys()) if rows_data else []
    table.schema_info = [
        {"field_id": f"col_{i}", "field_name": f, "field_type": "text"}
        for i, f in enumerate(final_fields)
    ]
    table.row_count = len(rows_data)
    table.column_count = len(final_fields)
    table.cleaning_rule_id = rule.id

    # 重建 content_text
    text_rows = []
    for rd in rows_data[:50]:  # 前50行用于 content_text
        text_rows.append(" | ".join(f"{k}: {v}" for k, v in rd.items() if v))
    table.content_text = "\n".join(text_rows)

    await db.commit()

    stats["rows_after"] = len(rows_data)
    stats["fields_after"] = len(final_fields)
    return stats
