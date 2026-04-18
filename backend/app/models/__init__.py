from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


from app.models.user import User, user_locations  # noqa: E402, F401
from app.models.location import Location  # noqa: E402, F401
from app.models.schedule import ShiftTemplate, ScheduledShift  # noqa: E402, F401
from app.models.time_clock import TimeClock, Break  # noqa: E402, F401
from app.models.time_off import TimeOffRequest, UnavailabilityRequest  # noqa: E402, F401
from app.models.shift_swap import ShiftSwapRequest, ShiftCoverageRequest  # noqa: E402, F401
from app.models.messaging import Message, MessageRecipient  # noqa: E402, F401
from app.models.cash_drawer import CashDrawer, UnexpectedExpense  # noqa: E402, F401
from app.models.payroll import PayrollRecord  # noqa: E402, F401
from app.models.audit_log import AuditLog  # noqa: E402, F401
