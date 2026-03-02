"""APScheduler 调度器初始化。"""

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


def init_scheduler() -> None:
    """初始化定时任务并启动调度器。"""
    from app.worker.tasks import etl_sync_job, cloud_folder_sync_job

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
    scheduler.start()
    logger.info("调度器已启动，ETL/云文件夹同步间隔: %d 分钟", settings.etl_cron_minutes)


def shutdown_scheduler() -> None:
    """关闭调度器。"""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("调度器已关闭")
