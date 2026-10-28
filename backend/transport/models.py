
from datetime import time

from django.conf import settings
from django.core.validators import (
    MaxValueValidator,
    MinValueValidator,
)
from django.db import models
from django.utils import timezone


SERVICE_OPEN_TIME = time(4, 0)
SERVICE_CLOSE_TIME = time(17, 0)

MAX_TAXI_CAPACITY = 15


# ============================================================
# ROUTE
# ============================================================

class Route(models.Model):
    name = models.CharField(
        max_length=100,
        unique=True,
    )

    origin = models.CharField(
        max_length=100,
    )

    destination = models.CharField(
        max_length=100,
    )

    is_active = models.BooleanField(
        default=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    class Meta:
        ordering = ["name"]

    @property
    def service_is_open(self):
        if not self.is_active:
            return False

        current_time = timezone.localtime().time()

        return (
            SERVICE_OPEN_TIME
            <= current_time
            < SERVICE_CLOSE_TIME
        )

    @property
    def service_status(self):
        if not self.is_active:
            return "INACTIVE"

        if self.service_is_open:
            return "OPEN"

        return "CLOSED"

    def __str__(self):
        return (
            f"{self.name}: "
            f"{self.origin} → {self.destination}"
        )


# ============================================================
# WAITING SPOT
# ============================================================

class WaitingSpot(models.Model):
    route = models.ForeignKey(
        Route,
        on_delete=models.CASCADE,
        related_name="waiting_spots",
    )

    name = models.CharField(
        max_length=100,
    )

    latitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        validators=[
            MinValueValidator(-90),
            MaxValueValidator(90),
        ],
    )

    longitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        validators=[
            MinValueValidator(-180),
            MaxValueValidator(180),
        ],
    )

    geofence_radius_meters = models.PositiveIntegerField(
        default=100,
        validators=[
            MinValueValidator(20),
            MaxValueValidator(1000),
        ],
    )

    # Order of waiting spots along a route.
    stop_order = models.PositiveIntegerField(
        default=0,
    )

    is_active = models.BooleanField(
        default=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    class Meta:
        ordering = [
            "route__name",
            "stop_order",
            "name",
        ]

        constraints = [
            models.UniqueConstraint(
                fields=["route", "name"],
                name="unique_waiting_spot_per_route",
            ),
        ]

    @property
    def service_is_open(self):
        return (
            self.is_active
            and self.route.service_is_open
        )

    def __str__(self):
        return (
            f"{self.name} — "
            f"{self.route.name}"
        )


# ============================================================
# WAITING REQUEST
# ============================================================

class WaitingRequest(models.Model):

    class Status(models.TextChoices):
        WAITING = "WAITING", "Waiting"
        ASSIGNED = "ASSIGNED", "Taxi assigned"
        BOARDED = "BOARDED", "Boarded"
        ARRIVED = "ARRIVED", "Arrived safely"
        CANCELLED = "CANCELLED", "Cancelled"

    class GeofenceState(models.TextChoices):
        UNKNOWN = "UNKNOWN", "Unknown"
        INSIDE = "INSIDE", "Inside geofence"
        OUTSIDE = "OUTSIDE", "Outside geofence"

    passenger = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="waiting_requests",
    )

    waiting_spot = models.ForeignKey(
        WaitingSpot,
        on_delete=models.PROTECT,
        related_name="waiting_requests",
    )

    # Legacy relationship retained temporarily so that
    # existing views and data continue to work.
    # The new DispatchRequest model will eventually
    # become the authoritative assignment relationship.
    dispatch_assignment = models.ForeignKey(
        "DispatchAssignment",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="waiting_requests",
    )

    # One waiting request represents one passenger group.
    party_size = models.PositiveSmallIntegerField(
        default=1,
        validators=[
            MinValueValidator(1),
            MaxValueValidator(MAX_TAXI_CAPACITY),
        ],
    )

    # A boarding code will be generated securely during
    # passenger check-in. Existing records can remain blank
    # until we implement the data migration.
    boarding_code = models.CharField(
        max_length=8,
        blank=True,
        default="",
        db_index=True,
    )

    passenger_latitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
    )

    passenger_longitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
    )

    distance_from_spot_meters = models.DecimalField(
        max_digits=8,
        decimal_places=2,
    )

    geofence_state = models.CharField(
        max_length=10,
        choices=GeofenceState.choices,
        default=GeofenceState.UNKNOWN,
    )

    last_geofence_checked_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.WAITING,
    )

    checked_in_at = models.DateTimeField(
        auto_now_add=True,
    )

    ended_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    arrival_confirmed_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    class Meta:
        ordering = ["-checked_in_at"]

        constraints = [
            models.UniqueConstraint(
                fields=["passenger"],
                condition=models.Q(
                    status__in=[
                        "WAITING",
                        "ASSIGNED",
                        "BOARDED",
                    ],
                ),
                name="one_active_passenger_trip",
            ),

            models.CheckConstraint(
                condition=(
                    models.Q(party_size__gte=1)
                    & models.Q(party_size__lte=15)
                ),
                name="waiting_party_size_1_to_15",
            ),
        ]

    def __str__(self):
        return (
            f"{self.passenger.username} — "
            f"{self.waiting_spot.name} — "
            f"{self.party_size} passenger(s) — "
            f"{self.get_status_display()}"
        )


# ============================================================
# DRIVER AVAILABILITY
# ============================================================

class DriverAvailability(models.Model):
    driver = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="driver_availability",
    )

    is_available = models.BooleanField(
        default=False,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    class Meta:
        verbose_name_plural = "Driver availability"

    def __str__(self):
        status = (
            "Available"
            if self.is_available
            else "Unavailable"
        )

        return (
            f"{self.driver.username} — "
            f"{status}"
        )


# ============================================================
# DISPATCH ASSIGNMENT
# ============================================================

class DispatchAssignment(models.Model):

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        ACCEPTED = "ACCEPTED", "Accepted"
        REJECTED = "REJECTED", "Rejected"
        EN_ROUTE = "EN_ROUTE", "En route"
        ARRIVED = "ARRIVED", "Arrived"
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"

    dispatcher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_dispatches",
    )

    driver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="driver_dispatches",
    )

    # New route relationship.
    # Nullable initially to preserve existing records.
    route = models.ForeignKey(
        Route,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="dispatch_assignments",
    )

    # Existing pickup spot relationship retained
    # for compatibility with the current frontend.
    waiting_spot = models.ForeignKey(
        WaitingSpot,
        on_delete=models.PROTECT,
        related_name="dispatch_assignments",
    )

    # This must eventually equal the total party size
    # of the reserved groups.
    passenger_count = models.PositiveIntegerField(
        validators=[
            MinValueValidator(1),
            MaxValueValidator(MAX_TAXI_CAPACITY),
        ],
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
    )

    notes = models.CharField(
        max_length=250,
        blank=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    responded_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    class Meta:
        ordering = ["-created_at"]

        constraints = [
            models.CheckConstraint(
                condition=models.Q(
                    passenger_count__gte=1,
                ),
                name="dispatch_passenger_count_at_least_one",
            ),

            models.UniqueConstraint(
                fields=["driver"],
                condition=models.Q(
                    status__in=[
                        "PENDING",
                        "ACCEPTED",
                        "EN_ROUTE",
                        "ARRIVED",
                    ],
                ),
                name="one_active_dispatch_per_driver",
            ),
        ]

    def __str__(self):
        return (
            f"{self.driver.username} → "
            f"{self.waiting_spot.name} — "
            f"{self.get_status_display()}"
        )


# ============================================================
# DISPATCH REQUEST
# CONNECTS MULTIPLE PASSENGER GROUPS TO ONE TAXI
# ============================================================

class DispatchRequest(models.Model):

    class Status(models.TextChoices):
        RESERVED = "RESERVED", "Reserved"
        BOARDED = "BOARDED", "Boarded"
        RELEASED = "RELEASED", "Released"
        CANCELLED = "CANCELLED", "Cancelled"

    dispatch = models.ForeignKey(
        DispatchAssignment,
        on_delete=models.PROTECT,
        related_name="group_links",
    )

    waiting_request = models.ForeignKey(
        WaitingRequest,
        on_delete=models.PROTECT,
        related_name="dispatch_links",
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.RESERVED,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    boarded_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    released_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    class Meta:
        ordering = ["created_at", "id"]

        constraints = [
            # Prevent the same request from being linked
            # twice to the same assignment.
            models.UniqueConstraint(
                fields=[
                    "dispatch",
                    "waiting_request",
                ],
                name="unique_dispatch_request_link",
            ),

            # A passenger group can be reserved or boarded
            # through only one active dispatch link.
            # Released links remain as history.
            models.UniqueConstraint(
                fields=["waiting_request"],
                condition=models.Q(
                    status__in=[
                        "RESERVED",
                        "BOARDED",
                    ],
                ),
                name="one_open_link_per_request",
            ),
        ]

    def __str__(self):
        return (
            f"Dispatch #{self.dispatch_id} — "
            f"Request #{self.waiting_request_id} — "
            f"{self.get_status_display()}"
        )


# ============================================================
# TRIP
# ============================================================

class Trip(models.Model):

    class Status(models.TextChoices):
        IN_PROGRESS = "IN_PROGRESS", "In progress"
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"

    dispatch = models.OneToOneField(
        DispatchAssignment,
        on_delete=models.PROTECT,
        related_name="trip",
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.IN_PROGRESS,
    )

    started_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    completed_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return (
            f"Trip #{self.pk} — "
            f"Dispatch #{self.dispatch_id} — "
            f"{self.get_status_display()}"
        )


# ============================================================
# DRIVER LOCATION
# ============================================================

class DriverLocation(models.Model):
    """
    GPS location reported during an active dispatch.

    API requirements:
    - Only the assigned driver may submit coordinates.
    - The responsible dispatcher may monitor the driver.
    - Only passengers linked to the active dispatch may
      access that taxi's passenger-facing tracking data.
    - Updates are accepted only during an active assignment.
    - Tracking stops when the assignment ends.
    """

    dispatch = models.ForeignKey(
        DispatchAssignment,
        on_delete=models.CASCADE,
        related_name="location_updates",
    )

    driver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="location_updates",
    )

    latitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        validators=[
            MinValueValidator(-90),
            MaxValueValidator(90),
        ],
    )

    longitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        validators=[
            MinValueValidator(-180),
            MaxValueValidator(180),
        ],
    )

    accuracy_meters = models.FloatField(
        null=True,
        blank=True,
        validators=[
            MinValueValidator(0),
        ],
    )

    recorded_at = models.DateTimeField(
        auto_now_add=True,
    )

    class Meta:
        ordering = ["-recorded_at"]

        indexes = [
            models.Index(
                fields=[
                    "dispatch",
                    "-recorded_at",
                ],
                name="driverloc_dispatch_time_idx",
            ),
        ]

    def __str__(self):
        return (
            f"{self.driver.username} — "
            f"Dispatch #{self.dispatch_id} — "
            f"{self.recorded_at}"
        )