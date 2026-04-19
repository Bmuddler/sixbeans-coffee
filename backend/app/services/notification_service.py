"""Twilio SMS notification integration."""

import json
import logging
from datetime import date, time

from app.config import settings

logger = logging.getLogger(__name__)


def user_wants_sms(user, notification_type: str) -> bool:
    if not user or not getattr(user, 'phone', None):
        return False
    prefs_str = getattr(user, 'sms_preferences', None)
    if not prefs_str:
        return True
    try:
        prefs = json.loads(prefs_str)
        return prefs.get(notification_type, True)
    except Exception:
        return True


def _format_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return None


def _format_time(t: time | str) -> str:
    if isinstance(t, str):
        h, m = t.split(":")[:2]
        hour = int(h)
    else:
        hour = t.hour
        m = f"{t.minute:02d}"
    ampm = "AM" if hour < 12 else "PM"
    display = hour % 12 or 12
    return f"{display}:{m} {ampm}"


def _format_date(d: date | str) -> str:
    if isinstance(d, str):
        from datetime import datetime as dt
        d = dt.strptime(d, "%Y-%m-%d").date()
    return d.strftime("%b %d")


async def send_sms(to_phone: str, message: str) -> dict:
    formatted = _format_phone(to_phone)
    if not formatted:
        logger.warning("Invalid phone number: %s", to_phone)
        return {"status": "invalid_phone"}

    if not settings.twilio_account_sid or not settings.twilio_auth_token:
        logger.warning("Twilio not configured, SMS not sent to %s", to_phone)
        return {"status": "not_configured"}

    try:
        from twilio.rest import Client
        client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
        msg = client.messages.create(
            body=message,
            from_=settings.twilio_phone_number,
            to=formatted,
        )
        logger.info("SMS sent to %s (SID: %s)", formatted, msg.sid)
        return {"status": "sent", "sid": msg.sid}
    except Exception as e:
        logger.error("Failed to send SMS to %s: %s", formatted, str(e))
        return {"status": "error", "message": str(e)}


async def notify_new_message(to_phone: str, sender_name: str, preview: str) -> dict:
    text = preview[:80] + ("..." if len(preview) > 80 else "")
    return await send_sms(
        to_phone,
        f"Six Beans: New message from {sender_name}: \"{text}\"",
    )


async def notify_shift_reminder(to_phone: str, employee_name: str, shift_date: date | str, start_time: time | str, location_name: str) -> dict:
    return await send_sms(
        to_phone,
        f"Six Beans: Hi {employee_name}, reminder you're scheduled at {location_name} tomorrow ({_format_date(shift_date)}) at {_format_time(start_time)}.",
    )


async def notify_schedule_change(to_phone: str, employee_name: str, change_type: str, shift_date: date | str, start_time: time | str, end_time: time | str) -> dict:
    return await send_sms(
        to_phone,
        f"Six Beans: Hi {employee_name}, your shift on {_format_date(shift_date)} has been {change_type}: {_format_time(start_time)}-{_format_time(end_time)}. Log in for details.",
    )


async def notify_shift_deleted(to_phone: str, employee_name: str, shift_date: date | str) -> dict:
    return await send_sms(
        to_phone,
        f"Six Beans: Hi {employee_name}, your shift on {_format_date(shift_date)} has been removed. Log in for details.",
    )


async def notify_shift_swap_request(to_phone: str, requester_name: str, shift_date: date | str) -> dict:
    return await send_sms(
        to_phone,
        f"Six Beans: {requester_name} wants to swap shifts with you on {_format_date(shift_date)}. Log in to review.",
    )


async def notify_shift_swap_decision(to_phone: str, employee_name: str, status: str, shift_date: date | str) -> dict:
    return await send_sms(
        to_phone,
        f"Six Beans: Hi {employee_name}, your shift swap request for {_format_date(shift_date)} has been {status}.",
    )


async def notify_coverage_posted(to_phone: str, poster_name: str, shift_date: date | str, start_time: time | str) -> dict:
    return await send_sms(
        to_phone,
        f"Six Beans: {poster_name} posted a shift for coverage on {_format_date(shift_date)} at {_format_time(start_time)}. Log in to claim it.",
    )


async def notify_coverage_claimed(to_phone: str, poster_name: str, claimer_name: str, shift_date: date | str) -> dict:
    return await send_sms(
        to_phone,
        f"Six Beans: {claimer_name} has claimed your shift on {_format_date(shift_date)}. Waiting for manager approval.",
    )


async def notify_coverage_decision(to_phone: str, employee_name: str, status: str, shift_date: date | str) -> dict:
    return await send_sms(
        to_phone,
        f"Six Beans: Hi {employee_name}, your coverage request for {_format_date(shift_date)} has been {status}.",
    )


async def notify_time_off_decision(to_phone: str, employee_name: str, status: str, start_date: date | str, end_date: date | str) -> dict:
    return await send_sms(
        to_phone,
        f"Six Beans: Hi {employee_name}, your time off request ({_format_date(start_date)} - {_format_date(end_date)}) has been {status}.",
    )


async def notify_time_off_submitted(to_phone: str, manager_name: str, employee_name: str, start_date: date | str, end_date: date | str) -> dict:
    return await send_sms(
        to_phone,
        f"Six Beans: {employee_name} has requested time off {_format_date(start_date)} - {_format_date(end_date)}. Log in to review.",
    )
