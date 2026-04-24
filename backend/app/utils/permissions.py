"""Role-based permission checks."""

from fastapi import HTTPException, status

from app.models.user import User, UserRole


def require_role(*allowed_roles: UserRole):
    """Check that the current user has one of the allowed roles."""

    def checker(current_user: User) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{current_user.role.value}' does not have permission for this action",
            )
        return current_user

    return checker


def is_owner(user: User) -> bool:
    return user.role == UserRole.owner


def is_manager_or_owner(user: User) -> bool:
    return user.role in (UserRole.owner, UserRole.manager)


def can_manage_location(user: User, location_id: int) -> bool:
    """Check if user can manage a specific location.

    Owners can manage all locations. Managers can only manage their assigned locations.
    """
    if is_owner(user):
        return True
    if user.role == UserRole.manager:
        return location_id in [loc.id for loc in user.locations]
    return False


def require_location_access(user: User, location_id: int) -> None:
    """Raise 403 if user cannot access the given location."""
    if not can_manage_location(user, location_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this location",
        )


def can_manage_employee(user: User, employee: User) -> bool:
    """True if `user` can review/mutate records owned by `employee`.

    Owners always can. Managers can only manage employees whose assigned
    locations overlap their own.
    """
    if is_owner(user):
        return True
    if user.role != UserRole.manager:
        return False
    manager_loc_ids = {loc.id for loc in user.locations}
    employee_loc_ids = {loc.id for loc in (employee.locations or [])}
    return bool(manager_loc_ids & employee_loc_ids)


def require_employee_access(user: User, employee: User) -> None:
    """Raise 403 if `user` cannot act on records owned by `employee`."""
    if not can_manage_employee(user, employee):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this employee",
        )
