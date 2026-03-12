"""飞书 Webhook 告警工具。"""

import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


async def send_alert(
    title: str,
    content: str,
    error_link: str | None = None,
) -> bool:
    """通过飞书 Webhook 发送告警消息卡片。

    Args:
        title: 告警标题。
        content: 错误详情。
        error_link: 可选的源表/错误链接。

    Returns:
        发送是否成功。
    """
    if not settings.feishu_webhook_url:
        logger.warning("飞书 Webhook URL 未配置，跳过告警: %s", title)
        return False

    elements = [
        {
            "tag": "div",
            "text": {"tag": "lark_md", "content": content},
        }
    ]

    if error_link:
        elements.append(
            {
                "tag": "action",
                "actions": [
                    {
                        "tag": "button",
                        "text": {"tag": "plain_text", "content": "查看详情"},
                        "url": error_link,
                        "type": "primary",
                    }
                ],
            }
        )

    card = {
        "msg_type": "interactive",
        "card": {
            "header": {
                "title": {"tag": "plain_text", "content": f"⚠️ {title}"},
                "template": "red",
            },
            "elements": elements,
        },
    }

    try:
        async with httpx.AsyncClient(verify=False) as client:
            resp = await client.post(settings.feishu_webhook_url, json=card)
            resp.raise_for_status()
            data = resp.json()
            if data.get("code") != 0:
                logger.error("Webhook 发送失败: %s", data.get("msg"))
                return False
            logger.info("告警已发送: %s", title)
            return True
    except Exception as e:
        logger.error("Webhook 发送异常: %s", e)
        return False
