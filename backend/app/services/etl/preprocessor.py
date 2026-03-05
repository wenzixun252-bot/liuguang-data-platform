"""ETL Step 1: 规则预处理 — 在 LLM 之前用纯程序做内容清洗。"""

import re
import unicodedata


class ContentPreprocessor:
    """对 content_text 做规则清洗，不依赖 LLM，零成本提升数据质量。"""

    def process(self, text: str) -> str:
        """完整预处理管道。"""
        if not text:
            return ""
        text = self.strip_html(text)
        text = self.strip_control_chars(text)
        text = self.normalize_whitespace(text)
        text = self.normalize_names(text)
        text = self.normalize_timestamps(text)
        return text.strip()

    @staticmethod
    def strip_html(text: str) -> str:
        """去除 HTML/XML 标签，保留文本内容。"""
        # 先处理常见的 HTML 实体
        text = text.replace("&nbsp;", " ")
        text = text.replace("&amp;", "&")
        text = text.replace("&lt;", "<")
        text = text.replace("&gt;", ">")
        text = text.replace("&quot;", '"')
        text = text.replace("&#39;", "'")
        # 移除 <style> 和 <script> 块（含内容）
        text = re.sub(r"<(style|script)[^>]*>.*?</\1>", "", text, flags=re.DOTALL | re.IGNORECASE)
        # 移除所有 HTML 标签
        text = re.sub(r"<[^>]+>", " ", text)
        return text

    @staticmethod
    def strip_control_chars(text: str) -> str:
        """去除不可见的控制字符（保留换行和制表符）。"""
        return "".join(
            ch for ch in text
            if ch in ("\n", "\t", "\r") or not unicodedata.category(ch).startswith("C")
        )

    @staticmethod
    def normalize_whitespace(text: str) -> str:
        """合并连续空行和多余空格。"""
        # 合并连续空行为最多两个换行
        text = re.sub(r"\n{3,}", "\n\n", text)
        # 每行内合并连续空格
        text = re.sub(r"[^\S\n]+", " ", text)
        # 去除每行首尾空格
        lines = [line.strip() for line in text.split("\n")]
        return "\n".join(lines)

    @staticmethod
    def normalize_names(text: str) -> str:
        """标准化人名格式：去除 @ 前缀、清理飞书 mention 格式。"""
        # 去除 @人名 中的 @ 符号（保留人名）
        text = re.sub(r"@(\S+)", r"\1", text)
        return text

    @staticmethod
    def normalize_timestamps(text: str) -> str:
        """统一时间戳格式。将 2024/01/01 格式统一为 2024-01-01。"""
        text = re.sub(
            r"(\d{4})/(\d{1,2})/(\d{1,2})",
            lambda m: f"{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}",
            text,
        )
        return text


# 模块级单例
content_preprocessor = ContentPreprocessor()
