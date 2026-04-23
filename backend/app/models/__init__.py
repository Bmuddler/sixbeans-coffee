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
from app.models.system_settings import SystemSettings  # noqa: E402, F401
from app.models.week_status import WeekScheduleStatus  # noqa: E402, F401
from app.models.form_submission import FormSubmission  # noqa: E402, F401
from app.models.company_document import CompanyDocument  # noqa: E402, F401
from app.models.job_application import JobApplication  # noqa: E402, F401
from app.models.supply_catalog import SupplyItem, SupplyOrder, SupplyOrderItem  # noqa: E402, F401
from app.models.usfoods import (  # noqa: E402, F401
    USFoodsProduct,
    USFoodsShopMapping,
    USFoodsWeeklyRun,
    USFoodsRunItem,
    USFoodsPriceHistory,
)
from app.models.daily_revenue import DailyRevenue  # noqa: E402, F401
from app.models.daily_labor import DailyLabor  # noqa: E402, F401
from app.models.expense import Expense  # noqa: E402, F401
from app.models.hourly_revenue import HourlyRevenue  # noqa: E402, F401
from app.models.ingestion_run import IngestionRun  # noqa: E402, F401
from app.models.scraper_session import ScraperSession  # noqa: E402, F401
