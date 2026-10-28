
from decimal import Decimal
import secrets

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

from rest_framework import serializers

from .models import (
    DispatchAssignment,
    DispatchRequest,
    MAX_TAXI_CAPACITY,
    DriverAvailability,
    DriverLocation,
    Route,
    WaitingRequest,
    WaitingSpot,
)

from .services import calculate_distance_meters


User = get_user_model()


# ============================================================
# WAITING SPOT SERIALIZER
# ============================================================

class WaitingSpotSerializer(serializers.ModelSerializer):

    route_name = serializers.CharField(
        source="route.name",
        read_only=True,
    )

    active_waiting_count = serializers.SerializerMethodField()
    waiting_group_count = serializers.SerializerMethodField()
    service_is_open = serializers.SerializerMethodField()

    class Meta:
        model = WaitingSpot

        fields = (
            "id",
            "route",
            "route_name",
            "name",
            "latitude",
            "longitude",
            "geofence_radius_meters",
            "is_active",
            "service_is_open",
            "active_waiting_count",
            "waiting_group_count",
            "created_at",
        )

        read_only_fields = (
            "id",
            "route_name",
            "service_is_open",
            "active_waiting_count",
            "waiting_group_count",
            "created_at",
        )

    def get_active_waiting_count(self, obj):
        annotated_count = getattr(
            obj,
            "active_waiting_count",
            None,
        )

        if annotated_count is not None:
            return annotated_count

        return obj.waiting_requests.filter(
            status=WaitingRequest.Status.WAITING,
            dispatch_assignment__isnull=True,
        ).aggregate(total=Sum("party_size"))["total"] or 0

    def get_waiting_group_count(self, obj):
        return obj.waiting_requests.filter(
            status=WaitingRequest.Status.WAITING,
            dispatch_assignment__isnull=True,
        ).count()

    def get_service_is_open(self, obj):
        return obj.service_is_open


# ============================================================
# ROUTE SERIALIZER
# ============================================================

class RouteSerializer(serializers.ModelSerializer):

    waiting_spots = WaitingSpotSerializer(
        many=True,
        read_only=True,
    )

    service_is_open = serializers.SerializerMethodField()
    service_status = serializers.SerializerMethodField()
    service_hours = serializers.SerializerMethodField()

    class Meta:
        model = Route

        fields = (
            "id",
            "name",
            "origin",
            "destination",
            "is_active",
            "service_is_open",
            "service_status",
            "service_hours",
            "created_at",
            "waiting_spots",
        )

        read_only_fields = (
            "id",
            "service_is_open",
            "service_status",
            "service_hours",
            "created_at",
            "waiting_spots",
        )

    def get_service_is_open(self, obj):
        return obj.service_is_open

    def get_service_status(self, obj):
        return obj.service_status

    def get_service_hours(self, obj):
        return "04:00–17:00"


# ============================================================
# WAITING REQUEST SERIALIZER
# ============================================================

class WaitingRequestSerializer(serializers.ModelSerializer):

    passenger_username = serializers.CharField(
        source="passenger.username",
        read_only=True,
    )

    waiting_spot_name = serializers.CharField(
        source="waiting_spot.name",
        read_only=True,
    )

    route_name = serializers.CharField(
        source="waiting_spot.route.name",
        read_only=True,
    )

    status_display = serializers.CharField(
        source="get_status_display",
        read_only=True,
    )

    dispatch_assignment_id = serializers.SerializerMethodField()
    dispatch_status = serializers.SerializerMethodField()
    dispatch_status_display = serializers.SerializerMethodField()
    driver_name = serializers.SerializerMethodField()
    can_confirm_arrival = serializers.SerializerMethodField()
    boarding_code = serializers.SerializerMethodField()

    class Meta:
        model = WaitingRequest

        fields = (
            "id",
            "passenger_username",
            "waiting_spot",
            "waiting_spot_name",
            "route_name",
            "distance_from_spot_meters",
            "party_size",
            "boarding_code",
            "geofence_state",
            "status",
            "status_display",
            "dispatch_assignment_id",
            "dispatch_status",
            "dispatch_status_display",
            "driver_name",
            "can_confirm_arrival",
            "checked_in_at",
            "ended_at",
            "arrival_confirmed_at",
        )

        read_only_fields = fields

    def get_boarding_code(self, obj):
        request = self.context.get("request")
        if request is not None and request.user.is_authenticated and request.user.pk == obj.passenger_id:
            return obj.boarding_code or None
        return None

    def get_dispatch_assignment_id(self, obj):
        if obj.dispatch_assignment_id:
            return obj.dispatch_assignment_id

        return None

    def get_dispatch_status(self, obj):
        if obj.dispatch_assignment:
            return obj.dispatch_assignment.status

        return None

    def get_dispatch_status_display(self, obj):
        if obj.dispatch_assignment:
            return (
                obj.dispatch_assignment.get_status_display()
            )

        return None

    def get_driver_name(self, obj):
        if not obj.dispatch_assignment:
            return None

        driver = obj.dispatch_assignment.driver
        full_name = driver.get_full_name().strip()

        return full_name or driver.username

    def get_can_confirm_arrival(self, obj):
        return (
            obj.status == WaitingRequest.Status.BOARDED
            and obj.dispatch_assignment is not None
            and obj.dispatch_assignment.status
            == DispatchAssignment.Status.COMPLETED
        )


# ============================================================
# PASSENGER GEOFENCE CHECK-IN
# ============================================================

class PassengerCheckInSerializer(serializers.Serializer):

    party_size = serializers.IntegerField(min_value=1, max_value=MAX_TAXI_CAPACITY, default=1)

    waiting_spot = serializers.PrimaryKeyRelatedField(
        queryset=(
            WaitingSpot.objects
            .select_related("route")
            .filter(
                is_active=True,
                route__is_active=True,
            )
        )
    )

    latitude = serializers.DecimalField(
        max_digits=9,
        decimal_places=6,
        min_value=Decimal("-90"),
        max_value=Decimal("90"),
    )

    longitude = serializers.DecimalField(
        max_digits=9,
        decimal_places=6,
        min_value=Decimal("-180"),
        max_value=Decimal("180"),
    )

    def validate(self, attrs):

        passenger = self.context["request"].user
        waiting_spot = attrs["waiting_spot"]

        if not waiting_spot.service_is_open:
            raise serializers.ValidationError({
                "detail": (
                    "TaxiLink passenger check-in is "
                    "unavailable between 17:00 and 04:00."
                )
            })

        existing_request = (
            WaitingRequest.objects
            .filter(
                passenger=passenger,
                status__in=[
                    WaitingRequest.Status.WAITING,
                    WaitingRequest.Status.ASSIGNED,
                    WaitingRequest.Status.BOARDED,
                ],
            )
            .first()
        )

        if existing_request:
            raise serializers.ValidationError({
                "detail": (
                    "You already have an active "
                    "TaxiLink trip or waiting request."
                )
            })

        distance = calculate_distance_meters(
            attrs["latitude"],
            attrs["longitude"],
            waiting_spot.latitude,
            waiting_spot.longitude,
        )

        if distance > waiting_spot.geofence_radius_meters:
            raise serializers.ValidationError({
                "location": (
                    f"You are approximately "
                    f"{distance:.0f} metres from "
                    f"{waiting_spot.name}. "
                    f"You must be within "
                    f"{waiting_spot.geofence_radius_meters} "
                    f"metres."
                )
            })

        attrs["calculated_distance"] = distance

        return attrs

    def create(self, validated_data):

        passenger = self.context["request"].user

        distance = validated_data.pop(
            "calculated_distance"
        )

        latitude = validated_data.pop("latitude")
        longitude = validated_data.pop("longitude")

        code = None
        for _ in range(30):
            candidate = f"{secrets.randbelow(100000000):08d}"
            if not WaitingRequest.objects.filter(boarding_code=candidate, status__in=[
                WaitingRequest.Status.WAITING, WaitingRequest.Status.ASSIGNED, WaitingRequest.Status.BOARDED,
            ]).exists():
                code = candidate
                break
        if code is None:
            raise serializers.ValidationError({"detail": "Unable to issue a boarding code. Please retry."})
        return WaitingRequest.objects.create(
            passenger=passenger,
            party_size=validated_data["party_size"],
            boarding_code=code,
            geofence_state=WaitingRequest.GeofenceState.INSIDE,
            last_geofence_checked_at=timezone.now(),
            waiting_spot=validated_data["waiting_spot"],
            passenger_latitude=latitude,
            passenger_longitude=longitude,
            distance_from_spot_meters=Decimal(
                f"{distance:.2f}"
            ),
        )


# ============================================================
# DRIVER AVAILABILITY
# ============================================================

class DriverAvailabilitySerializer(serializers.ModelSerializer):

    driver_id = serializers.IntegerField(
        source="driver.id",
        read_only=True,
    )

    driver_username = serializers.CharField(
        source="driver.username",
        read_only=True,
    )

    driver_name = serializers.SerializerMethodField()

    class Meta:
        model = DriverAvailability

        fields = (
            "driver_id",
            "driver_username",
            "driver_name",
            "is_available",
            "updated_at",
        )

        read_only_fields = (
            "driver_id",
            "driver_username",
            "driver_name",
            "updated_at",
        )

    def get_driver_name(self, obj):
        full_name = obj.driver.get_full_name().strip()
        return full_name or obj.driver.username


# ============================================================
# AVAILABLE DRIVER
# ============================================================

class AvailableDriverSerializer(serializers.ModelSerializer):

    full_name = serializers.SerializerMethodField()

    phone_number = serializers.CharField(
        read_only=True,
    )

    class Meta:
        model = User

        fields = (
            "id",
            "username",
            "full_name",
            "phone_number",
        )

    def get_full_name(self, obj):
        full_name = obj.get_full_name().strip()
        return full_name or obj.username


# ============================================================
# DISPATCH ASSIGNMENT
# ============================================================

class DispatchAssignmentSerializer(serializers.ModelSerializer):

    dispatcher_username = serializers.CharField(
        source="dispatcher.username",
        read_only=True,
    )

    driver_username = serializers.CharField(
        source="driver.username",
        read_only=True,
    )

    driver_name = serializers.SerializerMethodField()

    waiting_spot_name = serializers.CharField(
        source="waiting_spot.name",
        read_only=True,
    )

    route_name = serializers.CharField(
        source="waiting_spot.route.name",
        read_only=True,
    )

    status_display = serializers.CharField(
        source="get_status_display",
        read_only=True,
    )

    groups = serializers.SerializerMethodField()

    def get_groups(self, obj):
        return DispatchGroupSerializer(obj.group_links.select_related("waiting_request__passenger", "waiting_request__waiting_spot").all(), many=True).data

    # Navigation coordinates always come from
    # the dispatcher-created waiting spot.

    pickup_latitude = serializers.DecimalField(
        source="waiting_spot.latitude",
        max_digits=9,
        decimal_places=6,
        read_only=True,
    )

    pickup_longitude = serializers.DecimalField(
        source="waiting_spot.longitude",
        max_digits=9,
        decimal_places=6,
        read_only=True,
    )

    pickup_location_label = serializers.CharField(
        source="waiting_spot.name",
        read_only=True,
    )

    pickup_source = serializers.SerializerMethodField()

    pickup_geofence_radius_meters = serializers.IntegerField(
        source="waiting_spot.geofence_radius_meters",
        read_only=True,
    )

    class Meta:
        model = DispatchAssignment

        fields = (
            "id",
            "dispatcher",
            "dispatcher_username",
            "driver",
            "driver_username",
            "driver_name",
            "waiting_spot",
            "waiting_spot_name",
            "route_name",
            "passenger_count",
            "groups",
            "status",
            "status_display",
            "notes",
            "pickup_latitude",
            "pickup_longitude",
            "pickup_location_label",
            "pickup_source",
            "pickup_geofence_radius_meters",
            "created_at",
            "responded_at",
        )

        read_only_fields = (
            "id",
            "dispatcher",
            "dispatcher_username",
            "driver_username",
            "driver_name",
            "waiting_spot_name",
            "route_name",
            "status",
            "status_display",
            "pickup_latitude",
            "pickup_longitude",
            "pickup_location_label",
            "pickup_source",
            "pickup_geofence_radius_meters",
            "created_at",
            "responded_at",
        )

    def get_driver_name(self, obj):
        full_name = obj.driver.get_full_name().strip()
        return full_name or obj.driver.username

    def get_pickup_source(self, obj):
        return "waiting_spot_coordinates"

    def validate_driver(self, driver):
        if driver.role != "DRIVER":
            raise serializers.ValidationError(
                "The selected user is not a driver."
            )

        return driver

    def validate_waiting_spot(self, waiting_spot):

        if not waiting_spot.is_active:
            raise serializers.ValidationError(
                "The selected waiting spot is inactive."
            )

        if not waiting_spot.route.is_active:
            raise serializers.ValidationError(
                "The waiting spot belongs to an inactive route."
            )

        if not waiting_spot.service_is_open:
            raise serializers.ValidationError(
                "New dispatches are unavailable "
                "between 17:00 and 04:00."
            )

        return waiting_spot

    def validate_passenger_count(self, value):
        if not 1 <= value <= MAX_TAXI_CAPACITY:
            raise serializers.ValidationError("Taxi capacity must be between 1 and 15 passengers.")
        return value

    def validate(self, attrs):
        driver = attrs["driver"]
        spot = attrs["waiting_spot"]
        count = attrs["passenger_count"]
        availability, _ = DriverAvailability.objects.get_or_create(driver=driver)
        if not availability.is_available:
            raise serializers.ValidationError({"driver": "Driver is unavailable."})
        if DispatchAssignment.objects.filter(driver=driver, status__in=[
            "PENDING", "ACCEPTED", "EN_ROUTE", "ARRIVED",
        ]).exists():
            raise serializers.ValidationError({"driver": "Driver already has an active assignment."})
        requests = list(WaitingRequest.objects.filter(
            waiting_spot=spot,
            status=WaitingRequest.Status.WAITING,
            dispatch_assignment__isnull=True,
        ).order_by("checked_in_at", "pk").values_list("party_size", flat=True))
        available = sum(requests)
        if available < count:
            raise serializers.ValidationError({"passenger_count": f"Only {available} unassigned passengers are waiting."})
        if not self._subset_exists(requests, count):
            raise serializers.ValidationError({"passenger_count": "No combination of complete waiting groups matches that passenger count. Adjust the number; groups cannot be split."})
        return attrs

    @staticmethod
    def _subset_exists(sizes, target):
        reachable = {0}
        for size in sizes:
            reachable |= {n + size for n in tuple(reachable) if n + size <= target}
        return target in reachable

    @staticmethod
    def _choose_groups(requests, target):
        # Deterministic whole-group selection; prioritizes earlier requests.
        choices = {0: []}
        for group in requests:
            size = group.party_size
            for total, selected in list(choices.items()):
                new_total = total + size
                if new_total <= target and new_total not in choices:
                    choices[new_total] = selected + [group]
            if target in choices:
                return choices[target]
        return None

    def create(self, validated_data):
        request = self.context["request"]
        driver = validated_data["driver"]
        spot = validated_data["waiting_spot"]
        requested_count = validated_data["passenger_count"]
        try:
            with transaction.atomic():
                # Lock a single shared row for this pickup location to
                # serialize competing dispatch creations on PostgreSQL.
                locked_spot = WaitingSpot.objects.select_related("route").select_for_update().get(pk=spot.pk)
                if not locked_spot.service_is_open:
                    raise serializers.ValidationError({"detail": "New dispatches are unavailable outside operating hours."})
                availability = DriverAvailability.objects.select_for_update().get(driver=driver)
                if not availability.is_available or DispatchAssignment.objects.filter(
                    driver=driver, status__in=["PENDING", "ACCEPTED", "EN_ROUTE", "ARRIVED"]
                ).exists():
                    raise serializers.ValidationError({"driver": "Driver is no longer available."})
                groups = list(WaitingRequest.objects.select_for_update().filter(
                    waiting_spot=locked_spot,
                    status=WaitingRequest.Status.WAITING,
                    dispatch_assignment__isnull=True,
                ).order_by("checked_in_at", "pk"))
                selected = self._choose_groups(groups, requested_count)
                if not selected:
                    raise serializers.ValidationError({"passenger_count": "These passengers cannot be allocated as complete groups. Refresh demand and choose another total."})
                assignment = DispatchAssignment.objects.create(
                    dispatcher=request.user,
                    route=locked_spot.route,
                    **validated_data,
                )
                ids = [item.pk for item in selected]
                updated = WaitingRequest.objects.filter(
                    pk__in=ids,
                    status=WaitingRequest.Status.WAITING,
                    dispatch_assignment__isnull=True,
                ).update(status=WaitingRequest.Status.ASSIGNED, dispatch_assignment=assignment)
                if updated != len(ids):
                    raise serializers.ValidationError({"detail": "Waiting groups changed. Try again."})
                DispatchRequest.objects.bulk_create([
                    DispatchRequest(
                        dispatch=assignment, waiting_request=item,
                        status=DispatchRequest.Status.RESERVED,
                    ) for item in selected
                ])
                availability.is_available = False
                availability.save(update_fields=["is_available", "updated_at"])
                return assignment
        except IntegrityError:
            raise serializers.ValidationError({"detail": "A group or driver was reserved concurrently. Please refresh and retry."})




# ============================================================
# DRIVER LOCATION — DISPATCHER READ RESPONSE
# ============================================================

class DriverLocationSerializer(serializers.ModelSerializer):
    """
    Read-only GPS data.

    Only dispatcher-authorized views should
    return this serializer's data.
    """

    driver_id = serializers.IntegerField(
        read_only=True,
    )

    dispatch_id = serializers.IntegerField(
        read_only=True,
    )

    driver_username = serializers.CharField(
        source="driver.username",
        read_only=True,
    )

    driver_name = serializers.SerializerMethodField()

    waiting_spot_id = serializers.IntegerField(
        source="dispatch.waiting_spot_id",
        read_only=True,
    )

    waiting_spot_name = serializers.CharField(
        source="dispatch.waiting_spot.name",
        read_only=True,
    )

    class Meta:
        model = DriverLocation

        fields = (
            "id",
            "dispatch_id",
            "driver_id",
            "driver_username",
            "driver_name",
            "waiting_spot_id",
            "waiting_spot_name",
            "latitude",
            "longitude",
            "accuracy_meters",
            "recorded_at",
        )

        read_only_fields = fields

    def get_driver_name(self, obj):
        full_name = obj.driver.get_full_name().strip()
        return full_name or obj.driver.username


# ============================================================
# DRIVER LOCATION — GPS SUBMISSION
# ============================================================

class DriverLocationCreateSerializer(serializers.Serializer):
    """
    A driver submits GPS coordinates for
    their own active dispatch.

    The driver identity is obtained from
    the authenticated request, never from
    a client-supplied driver ID.
    """

    ACTIVE_STATUSES = (
        DispatchAssignment.Status.ACCEPTED,
        DispatchAssignment.Status.EN_ROUTE,
        DispatchAssignment.Status.ARRIVED,
    )

    dispatch = serializers.PrimaryKeyRelatedField(
        queryset=DispatchAssignment.objects.all()
    )

    latitude = serializers.DecimalField(
        max_digits=9,
        decimal_places=6,
        min_value=Decimal("-90"),
        max_value=Decimal("90"),
    )

    longitude = serializers.DecimalField(
        max_digits=9,
        decimal_places=6,
        min_value=Decimal("-180"),
        max_value=Decimal("180"),
    )

    accuracy_meters = serializers.FloatField(
        required=False,
        allow_null=True,
        min_value=0,
        max_value=10000,
    )

    def validate(self, attrs):

        request = self.context.get("request")

        if request is None or not request.user.is_authenticated:
            raise serializers.ValidationError({
                "detail": "Authentication is required."
            })

        driver = request.user
        dispatch = attrs["dispatch"]

        if getattr(driver, "role", None) != "DRIVER":
            raise serializers.ValidationError({
                "detail": (
                    "Only assigned drivers can "
                    "submit GPS locations."
                )
            })

        if dispatch.driver_id != driver.id:
            raise serializers.ValidationError({
                "dispatch": (
                    "You are not the driver assigned "
                    "to this dispatch."
                )
            })

        if dispatch.status not in self.ACTIVE_STATUSES:
            raise serializers.ValidationError({
                "dispatch": (
                    "Location sharing is only available "
                    "for accepted, active dispatches."
                )
            })

        return attrs

    def create(self, validated_data):

        driver = self.context["request"].user
        dispatch = validated_data["dispatch"]

        # Recheck the assignment when saving, since
        # its status may have changed after validation.

        with transaction.atomic():

            try:
                current_dispatch = (
                    DispatchAssignment.objects
                    .select_for_update()
                    .get(pk=dispatch.pk)
                )
            except DispatchAssignment.DoesNotExist:
                raise serializers.ValidationError({
                    "dispatch": "Dispatch no longer exists."
                })

            if current_dispatch.driver_id != driver.id:
                raise serializers.ValidationError({
                    "dispatch": (
                        "You are not assigned "
                        "to this dispatch."
                    )
                })

            if current_dispatch.status not in self.ACTIVE_STATUSES:
                raise serializers.ValidationError({
                    "dispatch": (
                        "This dispatch is no longer "
                        "accepting location updates."
                    )
                })

            return DriverLocation.objects.create(
                driver=driver,
                dispatch=current_dispatch,
                latitude=validated_data["latitude"],
                longitude=validated_data["longitude"],
                accuracy_meters=validated_data.get(
                    "accuracy_meters"
                ),
            )


# ============================================================
# DRIVER PICKUP ARRIVAL GEOFENCE VERIFICATION
# ============================================================

class DriverArrivalGeofenceSerializer(serializers.Serializer):
    """
    Validates whether the assigned driver
    is inside the designated waiting spot.

    The view must pass the selected assignment
    through serializer context as "dispatch".
    """

    latitude = serializers.DecimalField(
        max_digits=9,
        decimal_places=6,
        min_value=Decimal("-90"),
        max_value=Decimal("90"),
    )

    longitude = serializers.DecimalField(
        max_digits=9,
        decimal_places=6,
        min_value=Decimal("-180"),
        max_value=Decimal("180"),
    )

    accuracy_meters = serializers.FloatField(
        required=False,
        allow_null=True,
        min_value=0,
        max_value=10000,
    )

    def validate(self, attrs):

        request = self.context.get("request")
        dispatch = self.context.get("dispatch")

        if request is None or not request.user.is_authenticated:
            raise serializers.ValidationError({
                "detail": "Authentication is required."
            })

        if dispatch is None:
            raise serializers.ValidationError({
                "detail": "A dispatch assignment is required."
            })

        if dispatch.driver_id != request.user.id:
            raise serializers.ValidationError({
                "detail": (
                    "You are not the driver assigned "
                    "to this dispatch."
                )
            })

        if dispatch.status != DispatchAssignment.Status.EN_ROUTE:
            raise serializers.ValidationError({
                "detail": (
                    "The dispatch must be EN_ROUTE "
                    "before pickup arrival can be confirmed."
                )
            })

        waiting_spot = dispatch.waiting_spot

        distance = calculate_distance_meters(
            attrs["latitude"],
            attrs["longitude"],
            waiting_spot.latitude,
            waiting_spot.longitude,
        )

        if distance > waiting_spot.geofence_radius_meters:
            raise serializers.ValidationError({
                "location": (
                    f"You are approximately "
                    f"{distance:.0f} metres from "
                    f"{waiting_spot.name}. "
                    f"Move within the "
                    f"{waiting_spot.geofence_radius_meters}-metre "
                    f"pickup geofence before confirming arrival."
                )
            })

        attrs["distance_from_spot_meters"] = Decimal(
            f"{distance:.2f}"
        )

        return attrs

class BoardingCodeSerializer(serializers.Serializer):
    code = serializers.RegexField(regex=r"^[0-9]{8}$", max_length=8)


class DispatchGroupSerializer(serializers.ModelSerializer):
    waiting_spot_name = serializers.CharField(source="waiting_request.waiting_spot.name", read_only=True)
    party_size = serializers.IntegerField(source="waiting_request.party_size", read_only=True)
    passenger_username = serializers.CharField(source="waiting_request.passenger.username", read_only=True)

    class Meta:
        model = DispatchRequest
        fields = ("id", "waiting_request", "passenger_username", "waiting_spot_name", "party_size", "status", "boarded_at")
        read_only_fields = fields
