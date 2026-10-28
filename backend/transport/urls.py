
from django.urls import include, path

from rest_framework.routers import DefaultRouter

from .views import (
    ArrivalConfirmationsView,
    AvailableDriversView,
    CancelCurrentWaitingRequestView,
    ConfirmSafeArrivalView,
    CurrentWaitingRequestView,
    DispatchAssignmentViewSet,
    DriverAvailabilityView,
    PassengerCheckInView,
    RouteViewSet,
    WaitingSpotViewSet,
)


# ============================================================
# API ROUTER
# ============================================================

router = DefaultRouter()


# Routes
router.register(
    "routes",
    RouteViewSet,
    basename="route",
)


# Dispatcher-created waiting spots
router.register(
    "waiting-spots",
    WaitingSpotViewSet,
    basename="waiting-spot",
)


# Dispatch assignments, driver GPS and dispatcher monitoring
router.register(
    "dispatches",
    DispatchAssignmentViewSet,
    basename="dispatch",
)


# ============================================================
# URL PATTERNS
# ============================================================

urlpatterns = [

    path(
        "",
        include(router.urls),
    ),

    # Passenger check-in
    path(
        "waiting-requests/check-in/",
        PassengerCheckInView.as_view(),
        name="passenger-check-in",
    ),

    # Passenger current request
    path(
        "waiting-requests/current/",
        CurrentWaitingRequestView.as_view(),
        name="current-waiting-request",
    ),

    # Cancel waiting request
    path(
        "waiting-requests/cancel/",
        CancelCurrentWaitingRequestView.as_view(),
        name="cancel-waiting-request",
    ),

    # Passenger safe arrival confirmation
    path(
        "waiting-requests/confirm-arrival/",
        ConfirmSafeArrivalView.as_view(),
        name="confirm-safe-arrival",
    ),

    # Dispatcher views safe arrival confirmations
    path(
        "waiting-requests/arrival-confirmations/",
        ArrivalConfirmationsView.as_view(),
        name="arrival-confirmations",
    ),

    # Driver availability
    path(
        "drivers/availability/",
        DriverAvailabilityView.as_view(),
        name="driver-availability",
    ),

    # Dispatcher views available drivers
    path(
        "drivers/available/",
        AvailableDriversView.as_view(),
        name="available-drivers",
    ),

]