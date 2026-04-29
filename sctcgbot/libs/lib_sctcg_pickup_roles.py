import asyncio
import logging
import os
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

import aiohttp
import discord

from lib_sctcg_bridge import DjangoBotAPI, bridge_config
from pickup_channels import (
    PACIFIC_TZ,
    PICKUP_CATEGORY_ID,
    PickupCategoryNotFound,
    ROLLING_WINDOW_DAYS,
    _fetch_live_roles,
    _find_by_name,
    cleanup_expired_pickup_infrastructure,
    ensure_rolling_window,
    pacific_today,
    pickup_role_name,
    resolve_pickup_category,
)

logger = logging.getLogger(__name__)

PICKUP_ROLE_PREFIX = "Pickup: "
OUTBOX_LOOP_SECONDS = 10
LIFECYCLE_LOOP_SECONDS = 60
MUTATION_SLEEP_SECONDS = 0.5
BOOT_RETRY_SECONDS = 300

STATUS_PROCESSED = "PROCESSED"
STATUS_PROCESSED_IGNORED = "PROCESSED_IGNORED"
STATUS_PROCESSED_WITH_WARNING = "PROCESSED_WITH_WARNING"
STATUS_FAILED = "FAILED"
STATUS_DEAD_LETTER = "DEAD_LETTER"


@dataclass
class PickupRoleProcessResult:
    claimed: int = 0
    processed: int = 0
    ignored: int = 0
    warnings: int = 0
    failed: int = 0
    dead_lettered: int = 0
    errors: list[str] = field(default_factory=list)


def pickup_category_id_from_env() -> int:
    raw_value = os.environ.get("DISCORD_PICKUP_CATEGORY_ID", "").strip()
    if raw_value.isdigit():
        return int(raw_value)
    return PICKUP_CATEGORY_ID


def _event_key(event: dict[str, Any]) -> tuple[str, str]:
    return str(event.get("discord_id") or ""), str(event.get("pickup_date") or "")


def collapse_canceling_events(events: list[dict[str, Any]]) -> tuple[set[int], list[dict[str, Any]]]:
    pending_grants: dict[tuple[str, str], list[dict[str, Any]]] = {}
    canceled_ids: set[int] = set()
    for event in events:
        try:
            event_id = int(event.get("id"))
        except (TypeError, ValueError):
            continue
        key = _event_key(event)
        if event.get("event_type") == "GRANT":
            pending_grants.setdefault(key, []).append(event)
            continue
        if event.get("event_type") == "REVOKE" and pending_grants.get(key):
            grant = pending_grants[key].pop()
            try:
                canceled_ids.update({int(grant.get("id")), event_id})
            except (TypeError, ValueError):
                canceled_ids.add(event_id)

    remaining = [event for event in events if int(event.get("id", 0) or 0) not in canceled_ids]
    return canceled_ids, remaining


def _parse_pickup_date(value: Any) -> date:
    return date.fromisoformat(str(value))


def _member_pickup_roles(member: discord.Member) -> list[discord.Role]:
    return [role for role in getattr(member, "roles", []) if str(getattr(role, "name", "")).startswith(PICKUP_ROLE_PREFIX)]


async def _role_by_name(guild: discord.Guild, role_name: str) -> discord.Role | None:
    return _find_by_name(await _fetch_live_roles(guild), role_name)


async def _get_member(guild: discord.Guild, discord_id: str) -> discord.Member | None:
    try:
        member_id = int(str(discord_id).strip())
    except ValueError:
        return None

    member = guild.get_member(member_id)
    if member is not None:
        return member
    try:
        return await guild.fetch_member(member_id)
    except discord.NotFound:
        return None


async def _sleep_between_mutations(seconds: float = MUTATION_SLEEP_SECONDS) -> None:
    if seconds:
        await asyncio.sleep(seconds)


class PickupRoleAutomation:
    def __init__(
        self,
        client: discord.Client,
        *,
        api: DjangoBotAPI | None = None,
        category_id: int | None = None,
        mutation_sleep_seconds: float = MUTATION_SLEEP_SECONDS,
    ) -> None:
        self.client = client
        self.api = api or DjangoBotAPI()
        self.category_id = category_id or pickup_category_id_from_env()
        self.mutation_sleep_seconds = mutation_sleep_seconds

    def target_guilds(self) -> list[discord.Guild]:
        guilds: list[discord.Guild] = []
        for guild_id in bridge_config.discord_guild_ids:
            guild = self.client.get_guild(guild_id)
            if guild is not None:
                guilds.append(guild)
        if guilds:
            return guilds
        return list(getattr(self.client, "guilds", []))

    async def category_is_available(self, guild: discord.Guild) -> bool:
        try:
            await resolve_pickup_category(guild, self.category_id)
            return True
        except PickupCategoryNotFound as exc:
            logger.warning("%s; skipping pickup automation for this guild", exc)
            return False
        except Exception as exc:
            logger.warning(
                "Could not inspect pickup category %s in guild %s (%s): %s",
                self.category_id,
                getattr(guild, "name", "unknown"),
                getattr(guild, "id", "unknown"),
                exc,
            )
            return False

    async def fetch_configured_pickup_dates(self, *, today: date | None = None) -> set[date] | None:
        start_date = today or pacific_today()
        try:
            payload = await self.api.get_pickup_schedule_dates(start_date.isoformat(), ROLLING_WINDOW_DAYS)
            return {_parse_pickup_date(raw_date) for raw_date in payload.get("pickup_dates") or []}
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            logger.warning("Pickup schedule lookup skipped; Django API unavailable: %s", exc)
            return None
        except Exception as exc:
            logger.exception("Unexpected pickup schedule lookup failure")
            return None

    async def run_outbox_once(self, guild: discord.Guild) -> PickupRoleProcessResult:
        result = PickupRoleProcessResult()
        if not await self.category_is_available(guild):
            result.ignored = 1
            return result

        valid_pickup_dates = await self.fetch_configured_pickup_dates()
        if valid_pickup_dates is None:
            result.failed = 1
            result.errors.append("Pickup schedule unavailable.")
            return result

        try:
            payload = await self.api.claim_pickup_role_events()
            events = list(payload.get("events") or [])
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            logger.warning("Pickup role claim skipped; Django API unavailable: %s", exc)
            result.failed = 1
            result.errors.append(str(exc))
            return result
        except Exception as exc:
            logger.exception("Unexpected pickup role claim failure")
            result.failed = 1
            result.errors.append(str(exc))
            return result

        result.claimed = len(events)
        canceled_ids, remaining = collapse_canceling_events(events)
        for event_id in canceled_ids:
            await self._complete_event(event_id, STATUS_PROCESSED_IGNORED, "Same-batch grant/revoke collapsed before Discord mutation.")
            result.ignored += 1

        for event in remaining:
            await self._process_event(guild, event, result, valid_pickup_dates=valid_pickup_dates)
        return result

    async def _process_event(
        self,
        guild: discord.Guild,
        event: dict[str, Any],
        result: PickupRoleProcessResult,
        *,
        valid_pickup_dates: set[date],
    ) -> None:
        try:
            event_id = int(event.get("id"))
        except (TypeError, ValueError):
            result.failed += 1
            return

        try:
            event_status, message = await self._apply_event(guild, event, valid_pickup_dates=valid_pickup_dates)
            await self._complete_event(event_id, event_status, message)
            if event_status == STATUS_PROCESSED:
                result.processed += 1
            elif event_status == STATUS_PROCESSED_WITH_WARNING:
                result.warnings += 1
            elif event_status == STATUS_DEAD_LETTER:
                result.dead_lettered += 1
            else:
                result.ignored += 1
        except Exception as exc:
            await self._handle_event_exception(event_id, exc, result)

    async def _apply_event(
        self,
        guild: discord.Guild,
        event: dict[str, Any],
        *,
        valid_pickup_dates: set[date],
    ) -> tuple[str, str]:
        pickup_date = _parse_pickup_date(event.get("pickup_date"))
        event_type = str(event.get("event_type") or "")
        if event_type == "GRANT" and pickup_date not in valid_pickup_dates:
            return STATUS_PROCESSED_WITH_WARNING, "Pickup date is not configured as an active pickup day."

        role_name = pickup_role_name(pickup_date)
        role = await _role_by_name(guild, role_name)
        if role is None:
            await ensure_rolling_window(
                guild,
                category_id=self.category_id,
                today=pacific_today(),
                pickup_dates=valid_pickup_dates,
                log=logger,
            )
            role = await _role_by_name(guild, role_name)

        if role is None:
            if event_type == "REVOKE":
                return STATUS_PROCESSED_IGNORED, "Pickup role missing during revoke; no Discord mutation needed."
            return STATUS_PROCESSED_WITH_WARNING, "Pickup role missing after rolling-window repair."

        member = await _get_member(guild, str(event.get("discord_id") or ""))
        if member is None:
            return STATUS_PROCESSED_IGNORED, "Discord member not found in guild."

        member_roles = list(getattr(member, "roles", []))
        if event_type == "GRANT":
            if role in member_roles:
                return STATUS_PROCESSED_IGNORED, "Discord member already has pickup role."
            await member.add_roles(role, reason="SCTCG pickup role grant")
            await _sleep_between_mutations(self.mutation_sleep_seconds)
            return STATUS_PROCESSED, ""

        if event_type == "REVOKE":
            if role not in member_roles:
                return STATUS_PROCESSED_IGNORED, "Discord member did not have pickup role."
            await member.remove_roles(role, reason="SCTCG pickup role revoke")
            await _sleep_between_mutations(self.mutation_sleep_seconds)
            return STATUS_PROCESSED, ""

        return STATUS_DEAD_LETTER, f"Unknown pickup role event type {event_type!r}."

    async def _handle_event_exception(self, event_id: int, exc: Exception, result: PickupRoleProcessResult) -> None:
        message = str(exc)
        if isinstance(exc, discord.NotFound):
            await self._complete_event(event_id, STATUS_PROCESSED_IGNORED, message)
            result.ignored += 1
            return
        if getattr(exc, "code", None) == 30005:
            await self._complete_event(event_id, STATUS_PROCESSED_WITH_WARNING, message)
            result.warnings += 1
            return
        if isinstance(exc, discord.Forbidden):
            await self._complete_event(event_id, STATUS_DEAD_LETTER, message)
            result.dead_lettered += 1
            return

        await self._complete_event(event_id, STATUS_FAILED, message)
        result.failed += 1
        result.errors.append(message)

    async def _complete_event(self, event_id: int, status: str, message: str = "") -> None:
        try:
            await self.api.complete_pickup_role_event(event_id, status, message)
        except Exception:
            logger.exception("Failed to report pickup role event %s completion to Django", event_id)

    async def run_lifecycle_once(self, guild: discord.Guild, *, today: date | None = None) -> dict[str, Any]:
        run_date = today or pacific_today()
        run_date_text = run_date.isoformat()
        if not await self.category_is_available(guild):
            return {"status": "skipped", "run_date": run_date_text, "reason": "pickup_category_not_found"}

        valid_pickup_dates = await self.fetch_configured_pickup_dates(today=run_date)
        if valid_pickup_dates is None:
            return {"status": "failed", "run_date": run_date_text, "errors": ["Pickup schedule unavailable."]}

        try:
            claim = await self.api.claim_pickup_lifecycle(run_date_text)
        except Exception as exc:
            logger.warning("Pickup lifecycle claim skipped; Django API unavailable: %s", exc)
            return {"status": "failed", "run_date": run_date_text, "errors": [str(exc)]}

        if not claim.get("claimed"):
            return {"status": "skipped", "run_date": run_date_text}

        try:
            await ensure_rolling_window(
                guild,
                category_id=self.category_id,
                today=run_date,
                pickup_dates=valid_pickup_dates,
                log=logger,
            )
            cleanup = await cleanup_expired_pickup_infrastructure(guild, category_id=self.category_id, today=run_date, log=logger)
            if cleanup.get("errors"):
                error_text = "; ".join(cleanup["errors"])
                await self.api.finish_pickup_lifecycle(run_date_text, "FAILED", error_text)
                return {"status": "failed", "run_date": run_date_text, **cleanup}
            await self.api.finish_pickup_lifecycle(run_date_text, "COMPLETED")
            return {"status": "completed", "run_date": run_date_text, **cleanup}
        except Exception as exc:
            logger.exception("Pickup lifecycle failed")
            try:
                await self.api.finish_pickup_lifecycle(run_date_text, "FAILED", str(exc))
            except Exception:
                logger.exception("Failed to report pickup lifecycle failure to Django")
            return {"status": "failed", "run_date": run_date_text, "errors": [str(exc)]}

    async def boot_sync_guild(self, guild: discord.Guild) -> dict[str, Any]:
        try:
            if not await self.category_is_available(guild):
                return {"status": "skipped", "reason": "pickup_category_not_found", "added": 0, "removed": 0, "errors": []}

            current_day = pacific_today()
            active_dates = await self.fetch_configured_pickup_dates(today=current_day)
            if active_dates is None:
                return {"status": "failed", "reason": "Pickup schedule unavailable.", "added": 0, "removed": 0, "errors": ["Pickup schedule unavailable."]}
            await ensure_rolling_window(guild, category_id=self.category_id, today=current_day, pickup_dates=active_dates, log=logger)
            members = list(getattr(guild, "members", []))
            if getattr(guild, "chunked", False) is not True or len(members) <= 10:
                return {"status": "retry_later", "retry_after_seconds": BOOT_RETRY_SECONDS, "member_count": len(members)}

            payload = await self.api.get_pickup_role_assignments()
            expected_by_discord_id: dict[str, set[str]] = {}
            for row in payload.get("assignments") or []:
                pickup_date = _parse_pickup_date(row.get("pickup_date"))
                if pickup_date not in active_dates:
                    continue
                role_name = pickup_role_name(pickup_date)
                for discord_id in row.get("discord_ids") or []:
                    expected_by_discord_id.setdefault(str(discord_id), set()).add(role_name)

            role_by_name = {getattr(role, "name", ""): role for role in await _fetch_live_roles(guild)}
            result = {"status": "completed", "added": 0, "removed": 0, "errors": []}
            for member in members:
                member_id = str(getattr(member, "id", ""))
                expected_names = expected_by_discord_id.get(member_id, set())
                current_pickup_roles = _member_pickup_roles(member)
                current_names = {getattr(role, "name", "") for role in current_pickup_roles}

                for role_name in sorted(expected_names - current_names):
                    role = role_by_name.get(role_name)
                    if role is None:
                        continue
                    try:
                        await member.add_roles(role, reason="SCTCG pickup boot sync grant")
                        result["added"] += 1
                        await _sleep_between_mutations(self.mutation_sleep_seconds)
                    except Exception as exc:
                        result["errors"].append(f"grant:{member_id}:{role_name}:{exc}")
                        logger.exception("Failed to grant pickup role during boot sync")

                for role in current_pickup_roles:
                    role_name = getattr(role, "name", "")
                    if role_name in expected_names:
                        continue
                    try:
                        await member.remove_roles(role, reason="SCTCG pickup boot sync revoke")
                        result["removed"] += 1
                        await _sleep_between_mutations(self.mutation_sleep_seconds)
                    except Exception as exc:
                        result["errors"].append(f"revoke:{member_id}:{role_name}:{exc}")
                        logger.exception("Failed to revoke pickup role during boot sync")
            return result
        except Exception as exc:
            logger.exception("Pickup boot sync failed")
            return {"status": "failed", "reason": str(exc), "added": 0, "removed": 0, "errors": [str(exc)]}

    async def sync_member_join(self, member: discord.Member) -> dict[str, Any]:
        guild = getattr(member, "guild", None)
        if guild is None:
            return {"status": "skipped", "reason": "member has no guild"}

        try:
            if not await self.category_is_available(guild):
                return {"status": "skipped", "reason": "pickup_category_not_found", "added": 0}

            current_day = pacific_today()
            active_dates = await self.fetch_configured_pickup_dates(today=current_day)
            if active_dates is None:
                return {"status": "failed", "reason": "Pickup schedule unavailable.", "added": 0}
            payload = await self.api.get_pickup_member_dates(str(member.id))
            pickup_dates = [_parse_pickup_date(raw_date) for raw_date in payload.get("pickup_dates") or []]
            pickup_dates = [pickup_date for pickup_date in pickup_dates if pickup_date in active_dates]
            if not pickup_dates:
                return {"status": "completed", "added": 0}

            await ensure_rolling_window(guild, category_id=self.category_id, today=current_day, pickup_dates=active_dates, log=logger)
            role_by_name = {getattr(role, "name", ""): role for role in await _fetch_live_roles(guild)}
            current_roles = set(getattr(member, "roles", []))
            added = 0
            for pickup_date in pickup_dates:
                role = role_by_name.get(pickup_role_name(pickup_date))
                if role is None or role in current_roles:
                    continue
                try:
                    await member.add_roles(role, reason="SCTCG pickup member rejoin sync")
                    current_roles.add(role)
                    added += 1
                    await _sleep_between_mutations(self.mutation_sleep_seconds)
                except Exception:
                    logger.exception("Failed to grant pickup role during member join sync")
            return {"status": "completed", "added": added}
        except Exception as exc:
            logger.exception("Pickup member join sync failed")
            return {"status": "failed", "reason": str(exc), "added": 0}

    async def outbox_loop(self) -> None:
        while True:
            try:
                for guild in self.target_guilds():
                    await self.run_outbox_once(guild)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Pickup outbox loop tick failed")
            await asyncio.sleep(OUTBOX_LOOP_SECONDS)

    async def lifecycle_loop(self) -> None:
        while True:
            try:
                now = datetime.now(PACIFIC_TZ)
                if now.hour >= 21:
                    for guild in self.target_guilds():
                        await self.run_lifecycle_once(guild, today=now.date())
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Pickup lifecycle loop tick failed")
            await asyncio.sleep(LIFECYCLE_LOOP_SECONDS)