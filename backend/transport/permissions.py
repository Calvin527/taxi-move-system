
from rest_framework.permissions import (
    SAFE_METHODS,
    BasePermission,
)


# ============================================================
# DRIVER PERMISSION
# ============================================================

class IsDriver(BasePermission):

    message = "Only drivers can perform this action."

    def has_permission(self, request, view):
        return (
            request.user.is_authenticated
            and getattr(request.user, "role", None) == "DRIVER"
        )


# ============================================================
# DISPATCHER PERMISSION
# ============================================================

class IsDispatcher(BasePermission):

    message = "Only dispatchers can perform this action."

    def has_permission(self, request, view):
        return (
            request.user.is_authenticated
            and getattr(request.user, "role", None) == "DISPATCHER"
        )


# ============================================================
# DRIVER OR DISPATCHER PERMISSION
# ============================================================

class IsDriverOrDispatcher(BasePermission):

    message = (
        "Only drivers and dispatchers "
        "can access dispatches."
    )

    def has_permission(self, request, view):
        return (
            request.user.is_authenticated
            and getattr(request.user, "role", None)
            in {"DRIVER", "DISPATCHER"}
        )


# ============================================================
# DISPATCHER WRITE / AUTHENTICATED READ
# ============================================================

class IsDispatcherOrReadOnly(BasePermission):

    message = (
        "Only dispatchers can modify "
        "routes and waiting spots."
    )

    def has_permission(self, request, view):

        if not request.user.is_authenticated:
            return False

        if request.method in SAFE_METHODS:
            return True

        return (
            getattr(request.user, "role", None)
            == "DISPATCHER"
        )


# ============================================================
# PASSENGER PERMISSION
# ============================================================

class IsPassenger(BasePermission):

    message = (
        "Only passengers can manage "
        "waiting requests."
    )

    def has_permission(self, request, view):
        return (
            request.user.is_authenticated
            and getattr(request.user, "role", None)
            == "PASSENGER"
        )