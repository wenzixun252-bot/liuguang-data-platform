"""部门同步服务 — 从飞书拉取部门树与用户部门关系。"""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.department import Department, UserDepartment
from app.models.user import User
from app.services.feishu import feishu_client

logger = logging.getLogger(__name__)


async def sync_departments(db: AsyncSession) -> int:
    """从飞书拉取部门树，Upsert 到 departments 表。返回同步的部门数。"""
    departments = await feishu_client.get_department_list(parent_id="0")
    logger.info("从飞书获取到 %d 个部门", len(departments))

    # 第一轮：Upsert 所有部门（不设 parent_id）
    dept_id_map: dict[str, int] = {}  # feishu_department_id -> db id

    for dept in departments:
        feishu_dept_id = dept.get("open_department_id", dept.get("department_id", ""))
        name = dept.get("name", "")
        feishu_parent_id = dept.get("parent_department_id", "")
        order_val = dept.get("order", 0)
        # 将 order 转为 int（飞书可能返回字符串）
        if isinstance(order_val, str):
            try:
                order_val = int(order_val)
            except ValueError:
                order_val = 0

        if not feishu_dept_id:
            continue

        result = await db.execute(
            select(Department).where(Department.feishu_department_id == feishu_dept_id)
        )
        existing = result.scalar_one_or_none()

        if existing:
            existing.name = name
            existing.feishu_parent_id = feishu_parent_id
            existing.order_val = order_val
            dept_id_map[feishu_dept_id] = existing.id
        else:
            new_dept = Department(
                feishu_department_id=feishu_dept_id,
                name=name,
                feishu_parent_id=feishu_parent_id,
                order_val=order_val,
            )
            db.add(new_dept)
            await db.flush()
            dept_id_map[feishu_dept_id] = new_dept.id

    # 第二轮：设置 parent_id
    for dept in departments:
        feishu_dept_id = dept.get("open_department_id", dept.get("department_id", ""))
        feishu_parent_id = dept.get("parent_department_id", "")

        if feishu_dept_id in dept_id_map and feishu_parent_id and feishu_parent_id != "0":
            parent_db_id = dept_id_map.get(feishu_parent_id)
            if parent_db_id:
                result = await db.execute(
                    select(Department).where(Department.feishu_department_id == feishu_dept_id)
                )
                d = result.scalar_one_or_none()
                if d:
                    d.parent_id = parent_db_id

    await db.commit()
    logger.info("部门同步完成: %d 个部门", len(dept_id_map))
    return len(dept_id_map)


async def sync_user_departments(db: AsyncSession) -> int:
    """拉取各部门用户，写入 user_departments 表。返回写入的关系数。

    通过部门的 leader_user_id 来判断用户是否为管理者。
    """
    # 重新拉取部门列表以获取 leader_user_id
    departments_raw = await feishu_client.get_department_list(parent_id="0")
    leader_map: dict[str, str] = {}  # feishu_dept_id -> leader open_id
    for dept in departments_raw:
        feishu_dept_id = dept.get("open_department_id", dept.get("department_id", ""))
        leader_id = dept.get("leader_user_id", "")
        if feishu_dept_id and leader_id:
            leader_map[feishu_dept_id] = leader_id

    result = await db.execute(select(Department))
    all_depts = result.scalars().all()

    # 预加载已有用户，避免重复创建
    existing_users_result = await db.execute(select(User))
    user_cache: dict[str, User] = {
        u.feishu_open_id: u for u in existing_users_result.scalars().all()
    }

    count = 0
    for dept in all_depts:
        try:
            users = await feishu_client.get_department_users(dept.feishu_department_id)
        except Exception as e:
            logger.warning("获取部门 %s(%s) 用户失败: %s", dept.name, dept.feishu_department_id, e)
            continue

        leader_open_id = leader_map.get(dept.feishu_department_id, "")

        for u in users:
            open_id = u.get("open_id", "")
            if not open_id:
                continue

            # 从缓存查找或自动创建用户
            user = user_cache.get(open_id)
            if not user:
                # 自动创建用户（飞书通讯录中的人）
                user_name = u.get("name", open_id)
                avatar = u.get("avatar", {}).get("avatar_72", "") if isinstance(u.get("avatar"), dict) else ""
                email = u.get("email", "")
                user = User(
                    feishu_open_id=open_id,
                    name=user_name,
                    avatar_url=avatar or None,
                    email=email or None,
                    role="employee",
                )
                db.add(user)
                await db.flush()
                user_cache[open_id] = user
                logger.info("自动创建用户: %s (%s)", user_name, open_id)

            is_leader = (open_id == leader_open_id) if leader_open_id else False

            # Upsert user_department
            ud_result = await db.execute(
                select(UserDepartment).where(
                    UserDepartment.user_id == user.id,
                    UserDepartment.department_id == dept.id,
                )
            )
            existing = ud_result.scalar_one_or_none()
            if not existing:
                db.add(UserDepartment(
                    user_id=user.id,
                    department_id=dept.id,
                    is_manager=is_leader,
                ))
                count += 1
            else:
                existing.is_manager = is_leader

    await db.commit()
    logger.info("用户部门关系同步完成: %d 条新关系", count)
    return count
