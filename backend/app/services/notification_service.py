"""Twilio SMS notification integration."""

import logging

from app.config import settings

logger = logging.getLogger(__name__)


async def send_sms(to_phone: str, message: str) -> dict:
    """Send an SMS message via Twilio.

    Returns dict with message SID and status, or error info.
    """
    if not settings.twilio_account_sid or not settings.twilio_auth_token:
        logger.warning("Twilio not configured, SMS not sent to %s", to_phone)
        return {"status": "not_configured", "message": "Twilio credentials not set"}

    try:
        from twilio.rest import Client

        client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
        msg = client.messages.create(
            body=message,
            from_=settings.twilio_phone_number,
            to=to_phone,
        )
        return {"status": "sent", "sid": msg.sid}
    except Exception as e:
        logger.error("Failed to send SMS to %s: %s", to_phone, str(e))
        return {"status": "error", "message": str(e)}


async def notify_shift_swap(
    requester_name: str,
    target_phone: str,
    shift_date: str,
) -> dict:
    """Notify an employee about a shift swap request."""
    message = (
        f"Six Beans Coffee: {requester_name} has requested to swap shifts with you "
        f"on {shift_date}. Please log in to review."
    )
    return await send_sms(target_phone, message)


async def notify_schedule_published(
    employee_phone: str,
    week_start: str,
) -> dict:
    """Notify an employee that a new schedule has been published."""
    message = f"Six Beans Coffee: Your schedule for the week of {week_start} has been published. Please log in to view."
    return await send_sms(employee_phone, message)


async def notify_time_off_decision(
    employee_phone: str,
    status: str,
    dates: str,
) -> dict:
    """Notify an employee about their time off request decision."""
    message = f"Six Beans Coffee: Your time off request for {dates} has been {status}. Please log in for details."
    return await send_sms(employee_phone, message)
