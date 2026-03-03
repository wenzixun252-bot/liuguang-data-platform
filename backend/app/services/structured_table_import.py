"""结构化数据表导入服务：支持飞书多维表格、飞书表格、本地文件三种来源。"""

from __future__ import annotations

import csv
import io
import logging
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.structured_table import StructuredTable, StructuredTableRow
from app.services.feishu import feishu_client

logger = logging.getLogger(__name__)


def build_row_text(row_data: dict) -> str:
    """将行数据的所有值拼接为纯文本，用于全文搜索。"""
    parts = []
    for key, value in row_data.items():
        if value is not None:
            parts.append(f"{key}: {value}")
    return " | ".join(parts)


def _flatten_bitable_cell(value) -> str:
    """将多维表格单元格值扁平化为字符串。

    飞书多维表格的单元格值可能是复杂结构（列表、字典等），
    这里将其转为可读的字符串。
    """
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        # 多选字段、人员字段等返回列表
        texts = []
        for item in value:
            if isinstance(item, dict):
                # 人员: {"name": "张三", ...} / 选项: {"text": "xxx"}
                texts.append(item.get("name") or item.get("text") or str(item))
            else:
                texts.append(str(item))
        return ", ".join(texts)
    if isinstance(value, dict):
        # 链接: {"text": "...", "link": "..."}
        return value.get("text") or value.get("name") or str(value)
    return str(value)


async def _generate_summary(rows_sample: list[dict], table_name: str) -> str:
    """用 LLM 生成表级内容总结（取前 20 行数据概述）。"""
    try:
        from openai import AsyncOpenAI
        from app.config import settings

        if not settings.llm_api_key:
            return ""

        sample_text = "\n".join(
            " | ".join(f"{k}: {v}" for k, v in row.items() if v)
            for row in rows_sample[:20]
        )

        client = AsyncOpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
        )
        resp = await client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {
                    "role": "system",
                    "content": "你是数据分析助手。请用一段话（50-100字）总结以下表格数据的主要内容和用途。",
                },
                {
                    "role": "user",
                    "content": f"表格名称: {table_name}\n\n数据样本:\n{sample_text}",
                },
            ],
            max_tokens=200,
        )
        return resp.choices[0].message.content or ""
    except Exception as e:
        logger.warning("生成表格总结失败: %s", e)
        return ""


async def import_from_bitable(
    db: AsyncSession,
    owner_id: str,
    app_token: str,
    table_id: str,
    user_access_token: str | None = None,
) -> StructuredTable:
    """从飞书多维表格导入。"""
    # 1. 获取 schema（字段定义）
    fields = await feishu_client.get_bitable_fields(app_token, table_id, user_access_token)
    schema_info = [
        {"field_id": f.get("field_id", ""), "field_name": f.get("field_name", ""), "field_type": f.get("type", 0)}
        for f in fields
    ]
    field_names = {f.get("field_id", ""): f.get("field_name", "") for f in fields}

    # 2. 获取表名
    tables = await feishu_client.get_bitable_tables(app_token, user_access_token)
    table_name = "未命名表格"
    for t in tables:
        if t.get("table_id") == table_id:
            table_name = t.get("name", table_name)
            break

    # 3. 获取全部记录
    records = await feishu_client.list_all_bitable_records(
        app_token, table_id, user_access_token=user_access_token
    )

    # 4. 检查是否已存在（去重/更新）
    existing = await db.execute(
        select(StructuredTable).where(
            StructuredTable.owner_id == owner_id,
            StructuredTable.source_app_token == app_token,
            StructuredTable.source_table_id == table_id,
        )
    )
    table_obj = existing.scalar_one_or_none()
    if table_obj:
        # 已存在，执行更新（删除旧行，重新插入）
        await db.execute(
            delete(StructuredTableRow).where(StructuredTableRow.table_id == table_obj.id)
        )
    else:
        table_obj = StructuredTable(
            owner_id=owner_id,
            source_type="bitable",
            source_app_token=app_token,
            source_table_id=table_id,
        )
        db.add(table_obj)

    table_obj.name = table_name
    table_obj.schema_info = schema_info
    table_obj.source_url = f"https://feishu.cn/base/{app_token}?table={table_id}"
    table_obj.row_count = len(records)
    table_obj.column_count = len(schema_info)
    table_obj.synced_at = datetime.utcnow()

    await db.flush()  # 获取 table_obj.id

    # 5. 逐行创建 StructuredTableRow
    row_dicts: list[dict] = []
    for idx, record in enumerate(records):
        raw_fields = record.get("fields", {})
        # 用字段名替换字段 ID 作为 key，扁平化值
        row_data = {}
        for fid, val in raw_fields.items():
            fname = field_names.get(fid, fid)
            row_data[fname] = _flatten_bitable_cell(val)

        row_dicts.append(row_data)
        db.add(StructuredTableRow(
            table_id=table_obj.id,
            row_index=idx,
            row_data=row_data,
            row_text=build_row_text(row_data),
        ))

    # 6. 生成总结
    table_obj.summary = await _generate_summary(row_dicts, table_name)

    await db.commit()
    await db.refresh(table_obj)
    return table_obj


async def import_from_spreadsheet(
    db: AsyncSession,
    owner_id: str,
    spreadsheet_token: str,
    sheet_id: str,
    user_access_token: str | None = None,
) -> StructuredTable:
    """从飞书表格 (Spreadsheet) 导入。"""
    # 1. 获取表格元信息
    meta = await feishu_client.get_spreadsheet_meta(spreadsheet_token, user_access_token)
    spreadsheet_title = meta.get("title", "未命名表格")

    # 2. 获取工作表列表，找到目标 sheet 的名称和行列数
    sheets = await feishu_client.get_spreadsheet_sheets(spreadsheet_token, user_access_token)
    sheet_title = ""
    sheet_row_count = 0
    sheet_col_count = 0
    for s in sheets:
        if s.get("sheet_id") == sheet_id:
            sheet_title = s.get("title", "")
            grid_props = s.get("grid_properties", {})
            sheet_row_count = grid_props.get("row_count", 0)
            sheet_col_count = grid_props.get("column_count", 0)
            break

    table_name = f"{spreadsheet_title} - {sheet_title}" if sheet_title else spreadsheet_title

    # 3. 读取数据（用足够大的范围覆盖）
    # 限制最多读取 5000 行，避免超大表格内存溢出
    max_rows = min(sheet_row_count, 5000) if sheet_row_count > 0 else 5000
    max_cols = min(sheet_col_count, 26) if sheet_col_count > 0 else 26  # 最多 Z 列
    end_col_letter = chr(ord("A") + max_cols - 1)
    # 飞书 v2 API 要求用 sheet_id（技术ID）而不是 sheet_title（显示名）
    sheet_range = f"{sheet_id}!A1:{end_col_letter}{max_rows}"

    values = await feishu_client.get_spreadsheet_values(
        spreadsheet_token, sheet_range, user_access_token
    )

    if not values:
        raise ValueError("工作表为空，无数据可导入")

    # 首行为列名，后续为数据行
    headers = [str(h) if h is not None else f"列{i+1}" for i, h in enumerate(values[0])]
    data_rows = values[1:]

    # 构建 schema_info
    schema_info = [
        {"field_id": f"col_{i}", "field_name": h, "field_type": "text"}
        for i, h in enumerate(headers)
    ]

    # 4. 检查是否已存在
    existing = await db.execute(
        select(StructuredTable).where(
            StructuredTable.owner_id == owner_id,
            StructuredTable.source_app_token == spreadsheet_token,
            StructuredTable.source_table_id == sheet_id,
        )
    )
    table_obj = existing.scalar_one_or_none()
    if table_obj:
        await db.execute(
            delete(StructuredTableRow).where(StructuredTableRow.table_id == table_obj.id)
        )
    else:
        table_obj = StructuredTable(
            owner_id=owner_id,
            source_type="spreadsheet",
            source_app_token=spreadsheet_token,
            source_table_id=sheet_id,
        )
        db.add(table_obj)

    table_obj.name = table_name
    table_obj.schema_info = schema_info
    table_obj.source_url = f"https://feishu.cn/sheets/{spreadsheet_token}?sheet={sheet_id}"
    table_obj.row_count = len(data_rows)
    table_obj.column_count = len(headers)
    table_obj.synced_at = datetime.utcnow()

    await db.flush()

    # 5. 逐行创建
    row_dicts: list[dict] = []
    for idx, row in enumerate(data_rows):
        row_data = {}
        for col_idx, header in enumerate(headers):
            val = row[col_idx] if col_idx < len(row) else None
            row_data[header] = str(val) if val is not None else None

        row_dicts.append(row_data)
        db.add(StructuredTableRow(
            table_id=table_obj.id,
            row_index=idx,
            row_data=row_data,
            row_text=build_row_text(row_data),
        ))

    table_obj.summary = await _generate_summary(row_dicts, table_name)

    await db.commit()
    await db.refresh(table_obj)
    return table_obj


async def import_from_local_file(
    db: AsyncSession,
    owner_id: str,
    file_name: str,
    file_content: bytes,
) -> StructuredTable:
    """从本地 CSV/Excel 文件导入。"""
    lower_name = file_name.lower()

    if lower_name.endswith(".csv"):
        headers, data_rows = _parse_csv(file_content)
    elif lower_name.endswith((".xlsx", ".xls")):
        headers, data_rows = _parse_excel(file_content)
    else:
        raise ValueError(f"不支持的文件格式: {file_name}，请上传 .csv 或 .xlsx 文件")

    if not headers:
        raise ValueError("文件为空或无法解析列名")

    schema_info = [
        {"field_id": f"col_{i}", "field_name": h, "field_type": "text"}
        for i, h in enumerate(headers)
    ]

    table_obj = StructuredTable(
        owner_id=owner_id,
        name=file_name,
        source_type="local",
        file_name=file_name,
        schema_info=schema_info,
        row_count=len(data_rows),
        column_count=len(headers),
        synced_at=datetime.utcnow(),
    )
    db.add(table_obj)
    await db.flush()

    row_dicts: list[dict] = []
    for idx, row in enumerate(data_rows):
        row_data = {}
        for col_idx, header in enumerate(headers):
            val = row[col_idx] if col_idx < len(row) else None
            row_data[header] = str(val) if val is not None else None

        row_dicts.append(row_data)
        db.add(StructuredTableRow(
            table_id=table_obj.id,
            row_index=idx,
            row_data=row_data,
            row_text=build_row_text(row_data),
        ))

    table_obj.summary = await _generate_summary(row_dicts, file_name)

    await db.commit()
    await db.refresh(table_obj)
    return table_obj


def _parse_csv(content: bytes) -> tuple[list[str], list[list]]:
    """解析 CSV 文件，返回 (列名列表, 数据行列表)。"""
    # 尝试多种编码
    text = None
    for encoding in ("utf-8-sig", "utf-8", "gbk", "gb2312"):
        try:
            text = content.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ValueError("CSV 文件编码无法识别，请使用 UTF-8 编码")

    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        return [], []

    headers = rows[0]
    data_rows = rows[1:]
    return headers, data_rows


def _parse_excel(content: bytes) -> tuple[list[str], list[list]]:
    """解析 Excel 文件，返回 (列名列表, 数据行列表)。"""
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    ws = wb.active
    if ws is None:
        return [], []

    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    if not rows:
        return [], []

    headers = [str(h) if h is not None else f"列{i+1}" for i, h in enumerate(rows[0])]
    data_rows = [list(row) for row in rows[1:]]
    return headers, data_rows


async def sync_table(db: AsyncSession, table_id: int, user_access_token: str | None = None) -> dict:
    """重新同步飞书来源的结构化数据表（支持多维表格和飞书表格）。

    根据 source_type 自动派发到对应的导入逻辑。
    """
    result = await db.execute(
        select(StructuredTable).where(StructuredTable.id == table_id)
    )
    table_obj = result.scalar_one_or_none()
    if not table_obj:
        raise ValueError("表格不存在")

    if table_obj.source_type == "local":
        raise ValueError("本地上传的表格不支持同步，请重新上传")

    if table_obj.source_type == "bitable":
        updated = await import_from_bitable(
            db,
            table_obj.owner_id,
            table_obj.source_app_token,
            table_obj.source_table_id,
            user_access_token,
        )
    elif table_obj.source_type == "spreadsheet":
        updated = await import_from_spreadsheet(
            db,
            table_obj.owner_id,
            table_obj.source_app_token,
            table_obj.source_table_id,
            user_access_token,
        )
    else:
        raise ValueError(f"不支持的来源类型: {table_obj.source_type}")

    return {
        "id": updated.id,
        "name": updated.name,
        "row_count": updated.row_count,
        "synced_at": updated.synced_at.isoformat() if updated.synced_at else None,
    }
