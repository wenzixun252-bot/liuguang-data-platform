"""ETL Step 3: 后处理 — 数据质量评分、去重检测、文本分块。"""

import hashlib
import logging
import re

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# 质量评分权重
WEIGHTS = {
    "content_length": 0.3,    # 内容长度充足性
    "field_completeness": 0.3, # 关键字段完整度
    "no_garbage": 0.2,        # 无乱码/无意义内容
    "has_enrichment": 0.2,    # LLM 增强字段是否有值
}

# 分块参数
DEFAULT_MAX_CHUNK_CHARS = 1500  # 约 500 tokens（中文约 3 字符/token）
DEFAULT_OVERLAP_CHARS = 200    # 分块重叠字符数


class ContentPostprocessor:
    """数据后处理器：质量评分、simhash 去重、文本分块。"""

    # ── 质量评分 ────────────────────────────────────────

    def compute_quality_score(
        self,
        content_text: str,
        title: str | None = None,
        summary: str | None = None,
        keywords: list | None = None,
        involved_people: list | None = None,
    ) -> float:
        """基于多维度计算数据质量评分 (0-1)。"""
        scores = {}

        # 1. 内容长度充足性
        text_len = len(content_text) if content_text else 0
        if text_len >= 500:
            scores["content_length"] = 1.0
        elif text_len >= 100:
            scores["content_length"] = 0.7
        elif text_len >= 20:
            scores["content_length"] = 0.4
        else:
            scores["content_length"] = 0.1

        # 2. 关键字段完整度
        filled = sum(1 for v in [title, content_text] if v and v.strip())
        scores["field_completeness"] = filled / 2

        # 3. 无乱码检测
        scores["no_garbage"] = self._garbage_score(content_text)

        # 4. LLM 增强字段完整度
        enriched = sum(1 for v in [summary, keywords, involved_people] if v)
        scores["has_enrichment"] = enriched / 3

        # 加权求和
        total = sum(scores[k] * WEIGHTS[k] for k in WEIGHTS)
        return round(min(max(total, 0.0), 1.0), 3)

    @staticmethod
    def _garbage_score(text: str) -> float:
        """检测内容是否包含乱码/无意义字符，返回 0-1 分数。"""
        if not text:
            return 0.0
        # 统计非常规字符比例
        total = len(text)
        # 中文、英文、数字、常见标点视为正常字符
        normal = len(re.findall(r"[\u4e00-\u9fff\u3000-\u303fa-zA-Z0-9\s，。！？、；：""''（）《》\-.,!?;:'\"()\[\]{}@#$%^&*+=/<>]", text))
        ratio = normal / total if total > 0 else 0
        if ratio >= 0.9:
            return 1.0
        elif ratio >= 0.7:
            return 0.7
        elif ratio >= 0.5:
            return 0.4
        return 0.1

    # ── SimHash 去重 ─────────────────────────────────────

    @staticmethod
    def compute_content_hash(text: str) -> str:
        """计算内容的 simhash（简化版：对 content_text 做 MD5 后取前16位）。

        实际使用中相似度判断依赖 hash 碰撞 + 内容长度相近，
        完全相同的文档会产生相同 hash。
        """
        if not text:
            return ""
        # 标准化：去空白后取 MD5
        normalized = re.sub(r"\s+", "", text.strip())
        return hashlib.md5(normalized.encode("utf-8")).hexdigest()[:16]

    async def check_duplicate(
        self,
        content_hash: str,
        content_type: str,
        current_id: int | None,
        db: AsyncSession,
    ) -> int | None:
        """查找相同 hash 的已有记录，返回原始记录 ID 或 None。"""
        if not content_hash:
            return None

        table_name = {
            "document": "documents",
            "meeting": "meetings",
            "chat_message": "chat_messages",
            "structured_table": "structured_tables",
        }.get(content_type)

        if not table_name:
            return None

        # 查找相同 hash 的最早记录
        query = f"""
            SELECT id FROM {table_name}
            WHERE content_hash = :hash AND duplicate_of IS NULL
            ORDER BY id ASC LIMIT 1
        """
        result = await db.execute(text(query), {"hash": content_hash})
        row = result.fetchone()

        if row and (current_id is None or row[0] != current_id):
            return row[0]

        return None

    # ── 文本分块 ─────────────────────────────────────────

    def split_chunks(
        self,
        text: str,
        max_chars: int = DEFAULT_MAX_CHUNK_CHARS,
        overlap_chars: int = DEFAULT_OVERLAP_CHARS,
    ) -> list[str]:
        """按段落/语义切分文本块。

        策略：
        1. 先按双换行拆段落
        2. 合并短段落直到接近 max_chars
        3. 超长段落按句号切分
        """
        if not text or len(text) <= max_chars:
            return [text] if text else []

        # 按段落拆分
        paragraphs = re.split(r"\n{2,}", text.strip())
        paragraphs = [p.strip() for p in paragraphs if p.strip()]

        chunks: list[str] = []
        current = ""

        for para in paragraphs:
            if len(para) > max_chars:
                # 超长段落需要进一步切分
                if current:
                    chunks.append(current.strip())
                    current = ""
                sub_chunks = self._split_long_paragraph(para, max_chars, overlap_chars)
                chunks.extend(sub_chunks)
            elif len(current) + len(para) + 2 > max_chars:
                # 当前块满了，保存并开始新块
                if current:
                    chunks.append(current.strip())
                # 新块以重叠区域开始
                if overlap_chars > 0 and current:
                    current = current[-overlap_chars:] + "\n\n" + para
                else:
                    current = para
            else:
                current = (current + "\n\n" + para).strip() if current else para

        if current.strip():
            chunks.append(current.strip())

        return chunks

    @staticmethod
    def _split_long_paragraph(
        text: str,
        max_chars: int,
        overlap_chars: int,
    ) -> list[str]:
        """对超长段落按句号/分号切分。"""
        # 中英文句号、分号、问号、感叹号作为切分点
        sentences = re.split(r"(?<=[。！？；.!?;])\s*", text)
        sentences = [s.strip() for s in sentences if s.strip()]

        chunks: list[str] = []
        current = ""

        for sent in sentences:
            if len(current) + len(sent) + 1 > max_chars and current:
                chunks.append(current.strip())
                if overlap_chars > 0:
                    current = current[-overlap_chars:] + " " + sent
                else:
                    current = sent
            else:
                current = (current + " " + sent).strip() if current else sent

        if current.strip():
            chunks.append(current.strip())

        return chunks

    @staticmethod
    def estimate_token_count(text: str) -> int:
        """粗略估算 token 数量（中文约 1.5 字符/token，英文约 4 字符/token）。"""
        if not text:
            return 0
        chinese = len(re.findall(r"[\u4e00-\u9fff]", text))
        other = len(text) - chinese
        return int(chinese / 1.5 + other / 4)


# 模块级单例
content_postprocessor = ContentPostprocessor()
