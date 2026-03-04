"""APScheduler 调度器初始化。"""

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


def init_scheduler() -> None:
    """初始化定时任务并启动调度器。"""
    from app.worker.tasks import (
        etl_sync_job,
        cloud_folder_sync_job,
        todo_extract_job,
        todo_sync_status_job,
        kg_build_job,
        persona_generate_job,
        structured_table_sync_job,
        calendar_reminder_job,
    )

    scheduler.add_job(
        etl_sync_job,
        "interval",
        minutes=settings.etl_cron_minutes,
        id="etl_sync_job",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.add_job(
        cloud_folder_sync_job,
        "interval",
        minutes=settings.etl_cron_minutes,
        id="cloud_folder_sync_job",
        replace_existing=True,
        max_instances=1,
    )
    # 待办自动提取：每60分钟
    scheduler.add_job(
        todo_extract_job,
        "interval",
        minutes=60,
        id="todo_extract_job",
        replace_existing=True,
        max_instances=1,
    )
    # 飞书任务状态同步：每30分钟
    scheduler.add_job(
        todo_sync_status_job,
        "interval",
        minutes=30,
        id="todo_sync_status_job",
        replace_existing=True,
        max_instances=1,
    )
    # 知识图谱自动构建：每120分钟
    scheduler.add_job(
        kg_build_job,
        "interval",
        minutes=120,
        id="kg_build_job",
        replace_existing=True,
        max_instances=1,
    )
    # 结构化数据表同步：每120分钟（多维表格+飞书表格）
    scheduler.add_job(
        structured_table_sync_job,
        "interval",
        minutes=120,
        id="structured_table_sync_job",
        replace_existing=True,
        max_instances=1,
    )
    # 人物画像自动生成：每180分钟
    scheduler.add_job(
        persona_generate_job,
        "interval",
        minutes=180,
        id="persona_generate_job",
        replace_existing=True,
        max_instances=1,
    )
    # 日程提醒：每5分钟检查
    scheduler.add_job(
        calendar_reminder_job,
        "interval",
        minutes=5,
        id="calendar_reminder_job",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.start()
    logger.info(
        "调度器已启动，ETL/云文件夹同步间隔: %d 分钟, 数据表同步: 120分钟, KG构建: 120分钟, 画像生成: 180分钟",
        settings.etl_cron_minutes,
    )


def shutdown_scheduler() -> None:
    """关闭调度器。"""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("调度器已关闭")
