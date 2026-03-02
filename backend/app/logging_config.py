"""统一日志配置 — JSON 格式，ETL 日志按天轮转。"""

import logging
import logging.handlers
import os
import sys
from datetime import datetime


class JSONFormatter(logging.Formatter):
    """JSON 格式日志，便于日志采集系统解析。"""

    def format(self, record: logging.LogRecord) -> str:
        import json

        log_entry = {
            "timestamp": datetime.fromtimestamp(record.created, tz=__import__('datetime').timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
        }
        if record.exc_info and record.exc_info[1]:
            log_entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_entry, ensure_ascii=False)


def setup_logging() -> None:
    """配置应用日志。

    - 控制台: JSON 格式, INFO 级别
    - ETL 文件: 按天轮转, 保留 30 天
    """
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # 清除默认 handler
    root_logger.handlers.clear()

    # ── 控制台输出 ──
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(JSONFormatter())
    root_logger.addHandler(console_handler)

    # ── ETL 文件日志 (按天轮转) ──
    log_dir = os.environ.get("LOG_DIR", "logs")
    os.makedirs(log_dir, exist_ok=True)

    etl_handler = logging.handlers.TimedRotatingFileHandler(
        filename=os.path.join(log_dir, "etl.log"),
        when="midnight",
        interval=1,
        backupCount=30,
        encoding="utf-8",
    )
    etl_handler.setLevel(logging.INFO)
    etl_handler.setFormatter(JSONFormatter())

    # ETL 相关模块写入文件
    etl_logger = logging.getLogger("app.services.etl")
    etl_logger.addHandler(etl_handler)
    worker_logger = logging.getLogger("app.worker")
    worker_logger.addHandler(etl_handler)

    # 静默第三方库噪音
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("apscheduler").setLevel(logging.WARNING)
