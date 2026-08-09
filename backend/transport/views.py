from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Count, Prefetch, Q
from django.utils import timezone

from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    DispatchAssignment,
    DriverAvailability,
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
    DispatchAssignmentSerializer,
    DriverAvailabilitySerializer,
    PassengerCheckInSerializer,
    RouteSerializer,
    WaitingRequestSerializer,
    WaitingSpotSerializer,
)


def waiting_spot_queryset():
    return WaitingSpot.objects.select_related("route").annotate(
        active_waiting_count=Count(
            "waiting_requests",
            filter=Q(
                waiting_requests__status=(
                    WaitingRequest.Status.WAITING
                )
            ),
        )
    )

User = get_user_model()
class RouteViewSet(viewsets.ModelViewSet):
    serializer_class = RouteSerializer
    permission_classes = [IsDispatcherOrReadOnly]

    def get_queryset(self):
        routes = Route.objects.all()
        spots = waiting_spot_queryset()

        if self.request.user.role != "DISPATCHER":
            routes = routes.filter(is_active=True)
            spots = spots.filter(is_active=True)

        return routes.prefetch_related(
            Prefetch(
                "waiting_spots",
                queryset=spots,
            )
        )


class WaitingSpotViewSet(viewsets.ModelViewSet):
    serializer_class = WaitingSpotSerializer
    permission_classes = [IsDispatcherOrReadOnly]

    def get_queryset(self):
        spots = waiting_spot_queryset()

        if self.request.user.role != "DISPATCHER":
            spots = spots.filter(
                is_active=True,
                route__is_active=True,
            )

        return spots


class PassengerCheckInView(APIView):
    permission_classes = [IsPassenger]

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
                        "You already have an active waiting request."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        return Response(
            WaitingRequestSerializer(waiting_request).data,
            status=status.HTTP_201_CREATED,
        )


class CurrentWaitingRequestView(APIView):
    permission_classes = [IsPassenger]

    def get(self, request):
        waiting_request = (
            WaitingRequest.objects.select_related(
                "passenger",
                "waiting_spot",
                "waiting_spot__route",
            )
            .filter(
                passenger=request.user,
                status=WaitingRequest.Status.WAITING,
            )
            .first()
        )

        if waiting_request is None:
            return Response(
                {
                    "active": False,
                    "request": None,
                }
            )

        return Response(
            {
                "active": True,
                "request": WaitingRequestSerializer(
                    waiting_request
                ).data,
            }
        )


class CancelCurrentWaitingRequestView(APIView):
    permission_classes = [IsPassenger]

    def post(self, request):
        waiting_request = WaitingRequest.objects.filter(
            passenger=request.user,
            status=WaitingRequest.Status.WAITING,
        ).first()

        if waiting_request is None:
            return Response(
                {
                    "detail": (
                        "You do not have an active waiting request."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        waiting_request.status = WaitingRequest.Status.CANCELLED
        waiting_request.ended_at = timezone.now()

        waiting_request.save(
            update_fields=[
                "status",
                "ended_at",
            ]
        )

        return Response(
            WaitingRequestSerializer(waiting_request).data
        )

class DriverAvailabilityView(APIView):
    permission_classes = [IsDriver]

    def get(self, request):
        availability, _ = DriverAvailability.objects.get_or_create(
            driver=request.user
        )

        return Response(
            DriverAvailabilitySerializer(availability).data
        )

    def patch(self, request):
        availability, _ = DriverAvailability.objects.get_or_create(
            driver=request.user
        )

        requested_status = request.data.get("is_available")

        if not isinstance(requested_status, bool):
            return Response(
                {
                    "is_available": (
                        "This field must be true or false."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        active_dispatch_exists = DispatchAssignment.objects.filter(
            driver=request.user,
            status__in=[
                DispatchAssignment.Status.PENDING,
                DispatchAssignment.Status.ACCEPTED,
                DispatchAssignment.Status.EN_ROUTE,
                DispatchAssignment.Status.ARRIVED,
            ],
        ).exists()

        if requested_status and active_dispatch_exists:
            return Response(
                {
                    "detail": (
                        "You cannot become available while you have "
                        "an active dispatch assignment."
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
            DriverAvailabilitySerializer(availability).data
        )


class AvailableDriversView(APIView):
    permission_classes = [IsDispatcher]

    def get(self, request):
        drivers = User.objects.filter(role="DRIVER")

        for driver in drivers:
            DriverAvailability.objects.get_or_create(
                driver=driver
            )

        available_drivers = (
            User.objects.filter(
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


class DispatchAssignmentViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = DispatchAssignmentSerializer
    permission_classes = [IsDriverOrDispatcher]

    def get_queryset(self):
        queryset = DispatchAssignment.objects.select_related(
            "dispatcher",
            "driver",
            "waiting_spot",
            "waiting_spot__route",
        )

        if self.request.user.role == "DRIVER":
            return queryset.filter(driver=self.request.user)

        return queryset

    def create(self, request, *args, **kwargs):
        if request.user.role != "DISPATCHER":
            return Response(
                {
                    "detail": (
                        "Only dispatchers can create assignments."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        return super().create(request, *args, **kwargs)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsDriver],
    )
    def accept(self, request, pk=None):
        with transaction.atomic():
            assignment = (
                DispatchAssignment.objects.select_for_update()
                .select_related("driver")
                .filter(
                    pk=pk,
                    driver=request.user,
                )
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
                            "Only pending assignments can be accepted."
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
            DispatchAssignmentSerializer(assignment).data
        )

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsDriver],
    )
    def reject(self, request, pk=None):
        with transaction.atomic():
            assignment = (
                DispatchAssignment.objects.select_for_update()
                .filter(
                    pk=pk,
                    driver=request.user,
                )
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
                            "Only pending assignments can be rejected."
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

            availability, _ = (
                DriverAvailability.objects.select_for_update()
                .get_or_create(driver=request.user)
            )

            availability.is_available = True
            availability.save(
                update_fields=[
                    "is_available",
                    "updated_at",
                ]
            )

        return Response(
            DispatchAssignmentSerializer(assignment).data
        )