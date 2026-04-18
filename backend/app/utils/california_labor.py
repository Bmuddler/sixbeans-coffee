"""California labor law rules for time clock and payroll calculations."""

from datetime import timedelta

# California overtime thresholds
DAILY_OVERTIME_THRESHOLD_HOURS = 8.0
DAILY_DOUBLE_TIME_THRESHOLD_HOURS = 12.0
WEEKLY_OVERTIME_THRESHOLD_HOURS = 40.0

# Break requirements
FIRST_MEAL_BREAK_THRESHOLD = timedelta(hours=5)
SECOND_MEAL_BREAK_THRESHOLD = timedelta(hours=10)
REST_BREAK_INTERVAL = timedelta(hours=3.5)

# Break durations
PAID_REST_BREAK_MINUTES = 10
UNPAID_MEAL_BREAK_MINUTES = 30

# Clock rules
MAX_EARLY_CLOCK_IN_MINUTES = 5


def calculate_overtime(daily_hours: float, weekly_hours: float) -> dict:
    """Calculate regular, overtime, and double-time hours per CA law.

    California overtime:
    - Over 8 hours/day = 1.5x
    - Over 12 hours/day = 2x
    - Over 40 hours/week = 1.5x (if not already counted as daily OT)
    """
    regular = min(daily_hours, DAILY_OVERTIME_THRESHOLD_HOURS)
    daily_ot = 0.0
    double_time = 0.0

    if daily_hours > DAILY_DOUBLE_TIME_THRESHOLD_HOURS:
        double_time = daily_hours - DAILY_DOUBLE_TIME_THRESHOLD_HOURS
        daily_ot = DAILY_DOUBLE_TIME_THRESHOLD_HOURS - DAILY_OVERTIME_THRESHOLD_HOURS
    elif daily_hours > DAILY_OVERTIME_THRESHOLD_HOURS:
        daily_ot = daily_hours - DAILY_OVERTIME_THRESHOLD_HOURS

    return {
        "regular": regular,
        "overtime": daily_ot,
        "double_time": double_time,
    }


def required_breaks(shift_duration: timedelta) -> dict:
    """Determine required breaks for a shift duration per CA law.

    Returns dict with meal_breaks and rest_breaks counts.
    """
    hours = shift_duration.total_seconds() / 3600

    meal_breaks = 0
    if shift_duration >= FIRST_MEAL_BREAK_THRESHOLD:
        meal_breaks = 1
    if shift_duration >= SECOND_MEAL_BREAK_THRESHOLD:
        meal_breaks = 2

    # One 10-minute rest break per 4 hours (or major fraction thereof)
    rest_breaks = 0
    if hours > 0:
        rest_breaks = max(0, int(hours / 4))
        # Major fraction: if remainder > 2 hours, add another break
        remainder = hours % 4
        if remainder > 2:
            rest_breaks += 1

    return {
        "meal_breaks": meal_breaks,
        "rest_breaks": rest_breaks,
    }


def calculate_break_deductions(
    total_unpaid_break_minutes: float,
    required_meal_breaks: int,
) -> float:
    """Calculate break deductions in hours.

    Unpaid 30-minute meal breaks are deducted from total hours.
    Paid 10-minute rest breaks are NOT deducted.
    """
    return total_unpaid_break_minutes / 60.0


def is_early_clock_in_allowed(minutes_before_shift: float) -> bool:
    """Check if employee can clock in (max 5 minutes before shift)."""
    return minutes_before_shift <= MAX_EARLY_CLOCK_IN_MINUTES
