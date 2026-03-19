"""调度器：数据同步由登录触发，日程提醒保留后台定时（每2小时）。"""

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

# 防止同一用户短时间内重复触发（存储 owner_id -> 是否正在同步）
_syncing_users: set[str] = set()


def init_scheduler() -> None:
    """启动定时调度器，仅保留日程提醒（每5分钟）。"""
    from app.worker.tasks import calendar_reminder_job

    scheduler.add_job(
        calendar_reminder_job,
        "interval",
        minutes=5,
        id="calendar_reminder_job",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.start()
    logger.info("调度器已启动（日程提醒: 每5分钟，其余同步由登录触发）")


def shutdown_scheduler() -> None:
    """关闭调度器并清理状态。"""
    if scheduler.running:
        scheduler.shutdown(wait=False)
    _syncing_users.clear()
    logger.info("调度器已关闭")


async def trigger_login_sync(owner_id: str) -> None:
    """用户登录后触发一次全量同步（后台执行，不阻塞登录响应）。

    包含：ETL同步、云文件夹同步、待办提取、飞书任务状态同步、结构化数据表同步。
    """
    if owner_id in _syncing_users:
        logger.info("用户 %s 的同步任务仍在执行中，跳过本次触发", owner_id)
        return

    _syncing_users.add(owner_id)
    logger.info("用户 %s 登录，触发全量同步", owner_id)

    try:
        from app.database import async_session
        from app.models.user import User
        from sqlalchemy import select
        from app.worker.tasks import (
            etl_sync_job,
            cloud_folder_sync_job,
            todo_extract_job,
            todo_sync_status_job,
            structured_table_sync_job,
        )

        # 查找登录用户名，用于 ETL 任务日志标记触发人
        user_name = None
        try:
            async with async_session() as db:
                result = await db.execute(
                    select(User).where(User.feishu_open_id == owner_id)
                )
                user = result.scalar_one_or_none()
                if user:
                    user_name = user.name
        except Exception:
            pass

        jobs = [
            ("ETL同步", lambda: etl_sync_job(triggered_by=user_name)),
            ("云文件夹同步", cloud_folder_sync_job),
            ("待办提取", todo_extract_job),
            ("飞书任务状态同步", todo_sync_status_job),
            ("结构化数据表同步", structured_table_sync_job),
        ]

        for name, job_fn in jobs:
            try:
                await job_fn()
                logger.info("登录同步 [%s] 完成", name)
            except Exception as e:
                logger.error("登录同步 [%s] 失败: %s", name, e)

        logger.info("用户 %s 登录同步全部完成", owner_id)
    finally:
        _syncing_users.discard(owner_id)
