import asyncio
import logging

from lib_sctcg_pickup_roles import BOOT_RETRY_SECONDS, PickupRoleAutomation

logger = logging.getLogger(__name__)

OUTBOX_TASK_NAME = "sctcg-pickup-role-outbox-loop"
LIFECYCLE_TASK_NAME = "sctcg-pickup-lifecycle-loop"
BOOT_TASK_PREFIX = "sctcg-pickup-boot-sync"


def _task_exists(name: str) -> bool:
    for task in asyncio.all_tasks():
        if task.done():
            continue
        if task.get_name() == name:
            return True
    return False


async def _boot_sync_with_retry(automation: PickupRoleAutomation, guild):
    while True:
        try:
            result = await automation.boot_sync_guild(guild)
            if result.get("status") != "retry_later":
                return result
            await asyncio.sleep(int(result.get("retry_after_seconds") or BOOT_RETRY_SECONDS))
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Pickup boot sync retry loop failed")
            await asyncio.sleep(BOOT_RETRY_SECONDS)


async def on_ready_sctcg_pickup_roles(**kargs):
    try:
        client = kargs.get("client")
        if client is None:
            return
        automation = PickupRoleAutomation(client)

        if not _task_exists(OUTBOX_TASK_NAME):
            asyncio.create_task(automation.outbox_loop(), name=OUTBOX_TASK_NAME)
        if not _task_exists(LIFECYCLE_TASK_NAME):
            asyncio.create_task(automation.lifecycle_loop(), name=LIFECYCLE_TASK_NAME)

        for guild in automation.target_guilds():
            task_name = f"{BOOT_TASK_PREFIX}-{guild.id}"
            if not _task_exists(task_name):
                asyncio.create_task(_boot_sync_with_retry(automation, guild), name=task_name)
    except Exception:
        logger.exception("Failed to start SCTCG pickup role automation")


async def on_member_join_sctcg_pickup_roles(member, **kargs):
    try:
        client = kargs.get("client") or getattr(member, "_state", None) and getattr(member._state, "_get_client", lambda: None)()
        if client is None:
            return
        automation = PickupRoleAutomation(client)
        await automation.sync_member_join(member)
    except Exception:
        logger.exception("SCTCG pickup member-join automation failed")


commands = {
    "on-ready": on_ready_sctcg_pickup_roles,
    "on-member-join": on_member_join_sctcg_pickup_roles,
}