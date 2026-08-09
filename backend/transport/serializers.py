from decimal import Decimal
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

from rest_framework import serializers

from .models import (
    DispatchAssignment,
    DriverAvailability,
    Route,
    WaitingRequest,
    WaitingSpot,
)
from .services import calculate_distance_meters
User = get_user_model()


class WaitingSpotSerializer(serializers.ModelSerializer):
    route_name = serializers.CharField(
        source="route.name",
        read_only=True,
    )

    active_waiting_count = serializers.SerializerMethodField()

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
            "active_waiting_count",
            "created_at",
        )
        read_only_fields = (
            "id",
            "route_name",
            "active_waiting_count",
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
            status=WaitingRequest.Status.WAITING
        ).count()


class RouteSerializer(serializers.ModelSerializer):
    waiting_spots = WaitingSpotSerializer(
        many=True,
        read_only=True,
    )

    class Meta:
        model = Route
        fields = (
            "id",
            "name",
            "origin",
            "destination",
            "is_active",
            "created_at",
            "waiting_spots",
        )
        read_only_fields = (
            "id",
            "created_at",
            "waiting_spots",
        )


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

    class Meta:
        model = WaitingRequest
        fields = (
            "id",
            "passenger_username",
            "waiting_spot",
            "waiting_spot_name",
            "route_name",
            "passenger_latitude",
            "passenger_longitude",
            "distance_from_spot_meters",
            "status",
            "checked_in_at",
            "ended_at",
        )
        read_only_fields = fields


class PassengerCheckInSerializer(serializers.Serializer):
    waiting_spot = serializers.PrimaryKeyRelatedField(
        queryset=WaitingSpot.objects.select_related("route").filter(
            is_active=True,
            route__is_active=True,
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

        existing_request = WaitingRequest.objects.filter(
            passenger=passenger,
            status=WaitingRequest.Status.WAITING,
        ).first()

        if existing_request:
            raise serializers.ValidationError(
                {
                    "detail": (
                        "You already have an active waiting request "
                        f"at {existing_request.waiting_spot.name}."
                    )
                }
            )

        distance = calculate_distance_meters(
            attrs["latitude"],
            attrs["longitude"],
            waiting_spot.latitude,
            waiting_spot.longitude,
        )

        if distance > waiting_spot.geofence_radius_meters:
            raise serializers.ValidationError(
                {
                    "location": (
                        f"You are approximately {distance:.0f} metres "
                        f"from {waiting_spot.name}. You must be within "
                        f"{waiting_spot.geofence_radius_meters} metres."
                    )
                }
            )

        attrs["calculated_distance"] = distance

        return attrs

    def create(self, validated_data):
        passenger = self.context["request"].user
        distance = validated_data.pop("calculated_distance")
        latitude = validated_data.pop("latitude")
        longitude = validated_data.pop("longitude")

        return WaitingRequest.objects.create(
            passenger=passenger,
            waiting_spot=validated_data["waiting_spot"],
            passenger_latitude=latitude,
            passenger_longitude=longitude,
            distance_from_spot_meters=Decimal(
                f"{distance:.2f}"
            ),
        )

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


class AvailableDriverSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    phone_number = serializers.CharField(read_only=True)

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
            "status",
            "status_display",
            "notes",
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
            "created_at",
            "responded_at",
        )

    def get_driver_name(self, obj):
        full_name = obj.driver.get_full_name().strip()
        return full_name or obj.driver.username

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

        return waiting_spot

    def validate(self, attrs):
        driver = attrs["driver"]
        waiting_spot = attrs["waiting_spot"]
        passenger_count = attrs["passenger_count"]

        availability, _ = DriverAvailability.objects.get_or_create(
            driver=driver
        )

        if not availability.is_available:
            raise serializers.ValidationError(
                {
                    "driver": (
                        "The selected driver is currently unavailable."
                    )
                }
            )

        active_dispatch_exists = DispatchAssignment.objects.filter(
            driver=driver,
            status__in=[
                DispatchAssignment.Status.PENDING,
                DispatchAssignment.Status.ACCEPTED,
                DispatchAssignment.Status.EN_ROUTE,
                DispatchAssignment.Status.ARRIVED,
            ],
        ).exists()

        if active_dispatch_exists:
            raise serializers.ValidationError(
                {
                    "driver": (
                        "The selected driver already has an active "
                        "dispatch assignment."
                    )
                }
            )

        active_waiting_count = (
            waiting_spot.waiting_requests.filter(
                status=WaitingRequest.Status.WAITING
            ).count()
        )

        if active_waiting_count == 0:
            raise serializers.ValidationError(
                {
                    "waiting_spot": (
                        "There are currently no passengers waiting "
                        "at this spot."
                    )
                }
            )

        if passenger_count > active_waiting_count:
            raise serializers.ValidationError(
                {
                    "passenger_count": (
                        f"Only {active_waiting_count} passenger(s) "
                        "are currently waiting at this spot."
                    )
                }
            )

        return attrs

    def create(self, validated_data):
        request = self.context["request"]
        driver = validated_data["driver"]

        try:
            with transaction.atomic():
                availability = (
                    DriverAvailability.objects.select_for_update()
                    .get(driver=driver)
                )

                if not availability.is_available:
                    raise serializers.ValidationError(
                        {
                            "driver": (
                                "This driver is no longer available."
                            )
                        }
                    )

                assignment = DispatchAssignment.objects.create(
                    dispatcher=request.user,
                    **validated_data,
                )

                availability.is_available = False
                availability.save(
                    update_fields=[
                        "is_available",
                        "updated_at",
                    ]
                )

                return assignment

        except IntegrityError:
            raise serializers.ValidationError(
                {
                    "driver": (
                        "This driver already has an active dispatch."
                    )
                }
            )