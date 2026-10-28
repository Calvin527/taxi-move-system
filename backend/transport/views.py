
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import F, OuterRef, Prefetch, Q, Subquery, Sum
from django.utils import timezone

from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    SERVICE_CLOSE_TIME,
    SERVICE_OPEN_TIME,
    DispatchAssignment,
    DispatchRequest,
    Trip,
    DriverAvailability,
    DriverLocation,
    Route,
    WaitingRequest,
    WaitingSpot,
)

from .permissions import (
    IsDispatcher,
    IsDispatcherOrReadOnly,
    IsDriver,
    IsDriverOrDispatcher,
    IsPassenger,
)

from .serializers import (
    AvailableDriverSerializer,
    BoardingCodeSerializer,
    DispatchAssignmentSerializer,
    DriverArrivalGeofenceSerializer,
    DriverAvailabilitySerializer,
    DriverLocationCreateSerializer,
    DriverLocationSerializer,
    DispatchGroupSerializer,
    PassengerCheckInSerializer,
    RouteSerializer,
    WaitingRequestSerializer,
    WaitingSpotSerializer,
)


User = get_user_model()


# ============================================================
# OPERATING HOURS
# ============================================================

def taxi_service_is_open():
    current_time = timezone.localtime().time()

    return (
        SERVICE_OPEN_TIME
        <= current_time
        < SERVICE_CLOSE_TIME
    )


# ============================================================
# WAITING SPOT QUERYSET
# ============================================================

def waiting_spot_queryset():
    return (
        WaitingSpot.objects
        .select_related("route")
        .annotate(
            active_waiting_count=Sum(
                "waiting_requests__party_size",
                filter=Q(
                    waiting_requests__status=(
                        WaitingRequest.Status.WAITING
                    ),
                    waiting_requests__dispatch_assignment__isnull=True,
                ),
                default=0,
            )
        )
    )


# ============================================================
# ROUTES
# ============================================================

class RouteViewSet(viewsets.ModelViewSet):

    serializer_class = RouteSerializer

    permission_classes = [
        IsDispatcherOrReadOnly
    ]

    def get_queryset(self):
        routes = Route.objects.all()
        spots = waiting_spot_queryset()

        if getattr(self.request.user, "role", None) != "DISPATCHER":
            routes = routes.filter(is_active=True)

            spots = spots.filter(
                is_active=True,
                route__is_active=True,
            )

        return routes.prefetch_related(
            Prefetch(
                "waiting_spots",
                queryset=spots,
            )
        )


# ============================================================
# DISPATCHER-CREATED WAITING SPOTS
# ============================================================

class WaitingSpotViewSet(viewsets.ModelViewSet):

    serializer_class = WaitingSpotSerializer

    def perform_update(self, serializer):
        previous = self.get_object()
        if DispatchAssignment.objects.filter(waiting_spot=previous, status__in=["PENDING", "ACCEPTED", "EN_ROUTE", "ARRIVED"]).exists():
            for field in ("latitude", "longitude", "geofence_radius_meters", "route"):
                if field in serializer.validated_data and serializer.validated_data[field] != getattr(previous, field):
                    from rest_framework.exceptions import ValidationError
                    raise ValidationError({field: "Cannot change a pickup geofence with an active dispatch."})
        serializer.save()

    permission_classes = [
        IsDispatcherOrReadOnly
    ]

    def get_queryset(self):
        spots = waiting_spot_queryset()

        if getattr(self.request.user, "role", None) != "DISPATCHER":
            spots = spots.filter(
                is_active=True,
                route__is_active=True,
            )

        return spots


# ============================================================
# PASSENGER CHECK-IN
# ============================================================

class PassengerCheckInView(APIView):

    permission_classes = [
        IsPassenger
    ]

    def post(self, request):

        serializer = PassengerCheckInSerializer(
            data=request.data,
            context={"request": request},
        )

        serializer.is_valid(raise_exception=True)

        try:
            with transaction.atomic():
                waiting_request = serializer.save()

        except IntegrityError:
            return Response(
                {
                    "detail": (
                        "You already have an active "
                        "waiting request or trip."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        return Response(
            WaitingRequestSerializer(
                waiting_request, context={"request": request}
            ).data,
            status=status.HTTP_201_CREATED,
        )


# ============================================================
# PASSENGER CURRENT WAITING REQUEST
# ============================================================

class CurrentWaitingRequestView(APIView):

    permission_classes = [
        IsPassenger
    ]

    def get(self, request):

        waiting_request = (
            WaitingRequest.objects
            .select_related(
                "passenger",
                "waiting_spot",
                "waiting_spot__route",
                "dispatch_assignment",
                "dispatch_assignment__driver",
            )
            .filter(
                passenger=request.user,
                status__in=[
                    WaitingRequest.Status.WAITING,
                    WaitingRequest.Status.ASSIGNED,
                    WaitingRequest.Status.BOARDED,
                ],
            )
            .order_by("-checked_in_at")
            .first()
        )

        if waiting_request is None:
            return Response({
                "active": False,
                "request": None,
            })

        return Response({
            "active": True,
            "request": WaitingRequestSerializer(
                waiting_request, context={"request": request}
            ).data,
        })


# ============================================================
# PASSENGER CANCEL WAITING REQUEST
# ============================================================

class CancelCurrentWaitingRequestView(APIView):

    permission_classes = [
        IsPassenger
    ]

    def post(self, request):

        with transaction.atomic():

            waiting_request = (
                WaitingRequest.objects
                .select_for_update()
                .filter(
                    passenger=request.user,
                    status=WaitingRequest.Status.WAITING,
                )
                .first()
            )

            if waiting_request is None:

                active_trip_exists = (
                    WaitingRequest.objects
                    .filter(
                        passenger=request.user,
                        status__in=[
                            WaitingRequest.Status.ASSIGNED,
                            WaitingRequest.Status.BOARDED,
                        ],
                    )
                    .exists()
                )

                if active_trip_exists:
                    detail = (
                        "You cannot cancel this request "
                        "because a taxi has already "
                        "been assigned."
                    )
                else:
                    detail = (
                        "You do not have an active "
                        "waiting request."
                    )

                return Response(
                    {"detail": detail},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            waiting_request.status = (
                WaitingRequest.Status.CANCELLED
            )

            waiting_request.ended_at = timezone.now()

            waiting_request.save(
                update_fields=[
                    "status",
                    "ended_at",
                ]
            )

        return Response(
            WaitingRequestSerializer(
                waiting_request, context={"request": request}
            ).data
        )


# ============================================================
# PASSENGER SAFE ARRIVAL CONFIRMATION
# ============================================================

class ConfirmSafeArrivalView(APIView):

    permission_classes = [
        IsPassenger
    ]

    def post(self, request):

        with transaction.atomic():

            waiting_request = (
                WaitingRequest.objects
                .select_for_update()
                .select_related(
                    "waiting_spot",
                    "waiting_spot__route",
                    "dispatch_assignment",
                    "dispatch_assignment__driver",
                )
                .filter(
                    passenger=request.user,
                    status=WaitingRequest.Status.BOARDED,
                    dispatch_assignment__status=(
                        DispatchAssignment.Status.COMPLETED
                    ),
                )
                .order_by("-checked_in_at")
                .first()
            )

            if waiting_request is None:
                return Response(
                    {
                        "detail": (
                            "There is no completed trip "
                            "waiting for safe arrival "
                            "confirmation."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            waiting_request.status = (
                WaitingRequest.Status.ARRIVED
            )

            waiting_request.arrival_confirmed_at = (
                timezone.now()
            )

            waiting_request.save(
                update_fields=[
                    "status",
                    "arrival_confirmed_at",
                ]
            )

        return Response(
            WaitingRequestSerializer(
                waiting_request, context={"request": request}
            ).data
        )


# ============================================================
# DISPATCHER SAFE ARRIVAL CONFIRMATIONS
# ============================================================

class ArrivalConfirmationsView(APIView):

    permission_classes = [
        IsDispatcher
    ]

    def get(self, request):

        confirmations = (
            WaitingRequest.objects
            .select_related(
                "passenger",
                "waiting_spot",
                "waiting_spot__route",
                "dispatch_assignment",
                "dispatch_assignment__driver",
            )
            .filter(
                status=WaitingRequest.Status.ARRIVED,
                arrival_confirmed_at__isnull=False,
            )
            .order_by("-arrival_confirmed_at")[:20]
        )

        return Response(
            WaitingRequestSerializer(
                confirmations,
                many=True, context={"request": request},
            ).data
        )


# ============================================================
# DRIVER AVAILABILITY
# ============================================================

class DriverAvailabilityView(APIView):

    permission_classes = [
        IsDriver
    ]

    def get(self, request):

        availability, _ = (
            DriverAvailability.objects.get_or_create(
                driver=request.user
            )
        )

        if (
            not taxi_service_is_open()
            and availability.is_available
        ):
            availability.is_available = False

            availability.save(
                update_fields=[
                    "is_available",
                    "updated_at",
                ]
            )

        return Response(
            DriverAvailabilitySerializer(
                availability
            ).data
        )

    def patch(self, request):

        availability, _ = (
            DriverAvailability.objects.get_or_create(
                driver=request.user
            )
        )

        requested_status = request.data.get(
            "is_available"
        )

        if not isinstance(requested_status, bool):
            return Response(
                {
                    "is_available": (
                        "This field must be true or false."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if (
            requested_status
            and not taxi_service_is_open()
        ):
            if availability.is_available:
                availability.is_available = False

                availability.save(
                    update_fields=[
                        "is_available",
                        "updated_at",
                    ]
                )

            return Response(
                {
                    "detail": (
                        "Driver availability is closed "
                        "between 17:00 and 04:00."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        active_dispatch_exists = (
            DispatchAssignment.objects
            .filter(
                driver=request.user,
                status__in=[
                    DispatchAssignment.Status.PENDING,
                    DispatchAssignment.Status.ACCEPTED,
                    DispatchAssignment.Status.EN_ROUTE,
                    DispatchAssignment.Status.ARRIVED,
                ],
            )
            .exists()
        )

        if requested_status and active_dispatch_exists:
            return Response(
                {
                    "detail": (
                        "You cannot become available "
                        "while you have an active "
                        "dispatch assignment."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        availability.is_available = requested_status

        availability.save(
            update_fields=[
                "is_available",
                "updated_at",
            ]
        )

        return Response(
            DriverAvailabilitySerializer(
                availability
            ).data
        )


# ============================================================
# DISPATCHER AVAILABLE DRIVERS
# ============================================================

class AvailableDriversView(APIView):

    permission_classes = [
        IsDispatcher
    ]

    def get(self, request):

        drivers = User.objects.filter(
            role="DRIVER"
        )

        for driver in drivers:
            DriverAvailability.objects.get_or_create(
                driver=driver
            )

        if not taxi_service_is_open():

            DriverAvailability.objects.filter(
                driver__role="DRIVER",
                is_available=True,
            ).update(
                is_available=False,
                updated_at=timezone.now(),
            )

            return Response([])

        available_drivers = (
            User.objects
            .filter(
                role="DRIVER",
                driver_availability__is_available=True,
            )
            .exclude(
                driver_dispatches__status__in=[
                    DispatchAssignment.Status.PENDING,
                    DispatchAssignment.Status.ACCEPTED,
                    DispatchAssignment.Status.EN_ROUTE,
                    DispatchAssignment.Status.ARRIVED,
                ]
            )
            .distinct()
            .order_by("username")
        )

        return Response(
            AvailableDriverSerializer(
                available_drivers,
                many=True,
            ).data
        )


# ============================================================
# DISPATCH ASSIGNMENTS
# ============================================================

class DispatchAssignmentViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):

    serializer_class = DispatchAssignmentSerializer

    permission_classes = [
        IsDriverOrDispatcher
    ]

    def get_queryset(self):

        queryset = (
            DispatchAssignment.objects
            .select_related(
                "dispatcher",
                "driver",
                "waiting_spot",
                "waiting_spot__route",
            )
            .prefetch_related("waiting_requests")
        )

        if self.request.user.role == "DRIVER":
            return queryset.filter(
                driver=self.request.user
            )

        return queryset

    def create(self, request, *args, **kwargs):

        if request.user.role != "DISPATCHER":
            return Response(
                {
                    "detail": (
                        "Only dispatchers can "
                        "create assignments."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        if not taxi_service_is_open():
            return Response(
                {
                    "detail": (
                        "Taxi dispatch service is "
                        "unavailable between "
                        "17:00 and 04:00."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        return super().create(
            request,
            *args,
            **kwargs,
        )

    # ========================================================
    # DRIVER ACCEPTS DISPATCH
    # ========================================================

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsDriver],
    )
    def accept(self, request, pk=None):

        with transaction.atomic():

            assignment = (
                self.get_queryset()
                .select_for_update()
                .filter(pk=pk)
                .first()
            )

            if assignment is None:
                return Response(
                    {"detail": "Dispatch assignment not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if assignment.status != DispatchAssignment.Status.PENDING:
                return Response(
                    {
                        "detail": (
                            "Only pending assignments "
                            "can be accepted."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            assignment.status = DispatchAssignment.Status.ACCEPTED
            assignment.responded_at = timezone.now()

            assignment.save(
                update_fields=[
                    "status",
                    "responded_at",
                ]
            )

        return Response(
            self.get_serializer(assignment).data
        )

    # ========================================================
    # DRIVER REJECTS DISPATCH
    # ========================================================

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsDriver],
    )
    def reject(self, request, pk=None):

        with transaction.atomic():

            assignment = (
                self.get_queryset()
                .select_for_update()
                .filter(pk=pk)
                .first()
            )

            if assignment is None:
                return Response(
                    {"detail": "Dispatch assignment not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if assignment.status != DispatchAssignment.Status.PENDING:
                return Response(
                    {
                        "detail": (
                            "Only pending assignments "
                            "can be rejected."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            assignment.status = DispatchAssignment.Status.REJECTED
            assignment.responded_at = timezone.now()

            assignment.save(
                update_fields=[
                    "status",
                    "responded_at",
                ]
            )

            assignment.group_links.filter(
                status=DispatchRequest.Status.RESERVED
            ).update(status=DispatchRequest.Status.RELEASED, released_at=timezone.now())

            assignment.waiting_requests.filter(
                status=WaitingRequest.Status.ASSIGNED
            ).update(
                status=WaitingRequest.Status.WAITING,
                dispatch_assignment=None,
            )

            # Ensure this dispatch retains no GPS records.
            DriverLocation.objects.filter(
                dispatch=assignment
            ).delete()

            availability, _ = (
                DriverAvailability.objects
                .get_or_create(driver=request.user)
            )

            availability.is_available = taxi_service_is_open()

            availability.save(
                update_fields=[
                    "is_available",
                    "updated_at",
                ]
            )

        return Response(
            self.get_serializer(assignment).data
        )

    # ========================================================
    # DRIVER MARKS EN ROUTE
    # ========================================================

    @action(
        detail=True,
        methods=["post"],
        url_path="en-route",
        permission_classes=[IsDriver],
    )
    def mark_en_route(self, request, pk=None):

        with transaction.atomic():

            assignment = (
                self.get_queryset()
                .select_for_update()
                .filter(pk=pk)
                .first()
            )

            if assignment is None:
                return Response(
                    {"detail": "Dispatch assignment not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if assignment.status != DispatchAssignment.Status.ACCEPTED:
                return Response(
                    {
                        "detail": (
                            "Only accepted assignments "
                            "can be marked as en route."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            assignment.status = DispatchAssignment.Status.EN_ROUTE

            assignment.save(update_fields=["status"])

        return Response(
            self.get_serializer(assignment).data
        )

    # ========================================================
    # DRIVER SENDS LIVE GPS POSITION
    # ========================================================

    @action(
        detail=True,
        methods=["post"],
        url_path="location",
        permission_classes=[IsDriver],
    )
    def location(self, request, pk=None):
        """
        Accepts GPS coordinates from the driver
        assigned to this dispatch.

        Does not provide a driver-tracking
        read endpoint.
        """

        assignment = (
            self.get_queryset()
            .filter(pk=pk)
            .first()
        )

        if assignment is None:
            return Response(
                {"detail": "Dispatch assignment not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        payload = request.data.copy()

        # Never trust a client-supplied dispatch ID.
        payload["dispatch"] = assignment.pk

        serializer = DriverLocationCreateSerializer(
            data=payload,
            context={"request": request},
        )

        serializer.is_valid(raise_exception=True)
        location = serializer.save()

        return Response(
            {
                "detail": "Location update received.",
                "recorded_at": location.recorded_at,
            },
            status=status.HTTP_201_CREATED,
        )

    # ========================================================
    # DISPATCHER LIVE DRIVER MONITORING
    # ========================================================

    @action(
        detail=False,
        methods=["get"],
        url_path="live-locations",
        permission_classes=[IsDispatcher],
    )
    def live_locations(self, request):
        """
        Returns the most recent GPS position
        for each active assignment created
        by the authenticated dispatcher.

        Passengers and drivers cannot access
        this endpoint.
        """

        active_statuses = [
            DispatchAssignment.Status.ACCEPTED,
            DispatchAssignment.Status.EN_ROUTE,
            DispatchAssignment.Status.ARRIVED,
        ]

        latest_location_id = (
            DriverLocation.objects
            .filter(
                dispatch_id=OuterRef("dispatch_id"),
                driver_id=OuterRef("driver_id"),
            )
            .order_by(
                "-recorded_at",
                "-id",
            )
            .values("id")[:1]
        )

        locations = list(
            DriverLocation.objects
            .filter(
                dispatch__dispatcher=request.user,
                dispatch__status__in=active_statuses,
                driver_id=F("dispatch__driver_id"),
            )
            .annotate(
                latest_location_id=Subquery(
                    latest_location_id
                )
            )
            .filter(
                id=F("latest_location_id")
            )
            .select_related(
                "driver",
                "dispatch",
                "dispatch__waiting_spot",
            )
            .order_by("driver__username")
        )

        result = []

        stale_cutoff = (
            timezone.now() - timedelta(seconds=90)
        )

        for location in locations:

            data = dict(
                DriverLocationSerializer(
                    location
                ).data
            )

            data["is_stale"] = (
                location.recorded_at < stale_cutoff
            )

            result.append(data)

        return Response(result)

    # ========================================================
    # DRIVER ARRIVES AT GEOFENCED WAITING SPOT
    # ========================================================

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsDriver],
    )
    def arrived(self, request, pk=None):

        with transaction.atomic():

            assignment = (
                self.get_queryset()
                .select_for_update()
                .filter(pk=pk)
                .first()
            )

            if assignment is None:
                return Response(
                    {"detail": "Dispatch assignment not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if assignment.status != DispatchAssignment.Status.EN_ROUTE:
                return Response(
                    {
                        "detail": (
                            "Only en route assignments "
                            "can be marked as arrived."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Fresh coordinates must be submitted
            # with the arrival confirmation.

            serializer = DriverArrivalGeofenceSerializer(
                data=request.data,
                context={
                    "request": request,
                    "dispatch": assignment,
                },
            )

            serializer.is_valid(raise_exception=True)

            coordinates = serializer.validated_data

            # Save the verified arrival position.

            DriverLocation.objects.create(
                dispatch=assignment,
                driver=request.user,
                latitude=coordinates["latitude"],
                longitude=coordinates["longitude"],
                accuracy_meters=coordinates.get(
                    "accuracy_meters"
                ),
            )

            assignment.status = DispatchAssignment.Status.ARRIVED
            assignment.save(update_fields=["status"])

            # Arrival at pickup is not proof of boarding.
            # Each reserved group must present its boarding code.

        return Response(
            self.get_serializer(assignment).data
        )

    # ========================================================
    # VERIFY BOARDING CODE FOR A WHOLE PASSENGER GROUP
    # ========================================================

    @action(detail=True, methods=["post"], url_path="verify-boarding", permission_classes=[IsDriver])
    def verify_boarding(self, request, pk=None):
        from secrets import compare_digest
        serializer = BoardingCodeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        code = serializer.validated_data["code"]
        with transaction.atomic():
            assignment = self.get_queryset().select_for_update().filter(pk=pk).first()
            if assignment is None:
                return Response({"detail": "Dispatch assignment not found."}, status=404)
            if assignment.status != DispatchAssignment.Status.ARRIVED:
                return Response({"detail": "Driver must reach the pickup geofence before boarding."}, status=400)
            links = list(DispatchRequest.objects.select_for_update().select_related("waiting_request").filter(
                dispatch=assignment, status=DispatchRequest.Status.RESERVED,
            ))
            matched = next((link for link in links if link.waiting_request.boarding_code and compare_digest(link.waiting_request.boarding_code, code)), None)
            if matched is None:
                return Response({"detail": "Invalid boarding code for an unboarded group."}, status=400)
            now = timezone.now()
            matched.status = DispatchRequest.Status.BOARDED
            matched.boarded_at = now
            matched.save(update_fields=["status", "boarded_at"])
            group = matched.waiting_request
            group.status = WaitingRequest.Status.BOARDED
            group.save(update_fields=["status"])
            trip, _ = Trip.objects.get_or_create(dispatch=assignment, defaults={"started_at": now})
            if trip.started_at is None:
                trip.started_at = now
                trip.save(update_fields=["started_at", "updated_at"])
        return Response({"detail": "Group boarding confirmed.", "party_size": group.party_size, "remaining_groups": assignment.group_links.filter(status=DispatchRequest.Status.RESERVED).count()})

    # ========================================================
    # DRIVER COMPLETES TRIP
    # ========================================================

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsDriver],
    )
    def completed(self, request, pk=None):

        with transaction.atomic():

            assignment = (
                self.get_queryset()
                .select_for_update()
                .filter(pk=pk)
                .first()
            )

            if assignment is None:
                return Response(
                    {"detail": "Dispatch assignment not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if assignment.status != DispatchAssignment.Status.ARRIVED:
                return Response(
                    {
                        "detail": (
                            "Only arrived assignments "
                            "can be marked as completed."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            links = assignment.group_links.all()
            if not links.exists():
                return Response({"detail": "This dispatch has no registered passenger groups. Complete legacy assignments through a controlled data repair."}, status=400)
            if links.exclude(status=DispatchRequest.Status.BOARDED).exists():
                return Response({"detail": "All assigned passenger groups must verify boarding before completion."}, status=400)
            now = timezone.now()
            trip, _ = Trip.objects.get_or_create(dispatch=assignment, defaults={"started_at": now})
            trip.status = Trip.Status.COMPLETED
            trip.completed_at = now
            trip.save(update_fields=["status", "completed_at", "updated_at"])
            assignment.status = DispatchAssignment.Status.COMPLETED
            assignment.save(update_fields=["status"])
            assignment.waiting_requests.filter(status=WaitingRequest.Status.BOARDED).update(ended_at=now)

            # Stop retaining this dispatch's
            # GPS movement records.

            DriverLocation.objects.filter(
                dispatch=assignment
            ).delete()

            availability, _ = (
                DriverAvailability.objects
                .get_or_create(driver=request.user)
            )

            # Existing trips can finish after 17:00,
            # but the driver must remain unavailable
            # while the service is closed.

            availability.is_available = taxi_service_is_open()

            availability.save(
                update_fields=[
                    "is_available",
                    "updated_at",
                ]
            )

        return Response(
            self.get_serializer(assignment).data
        )