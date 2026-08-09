from rest_framework import generics
from rest_framework.permissions import AllowAny, IsAuthenticated

from .serializers import (
    PassengerRegistrationSerializer,
    UserProfileSerializer,
)


class PassengerRegistrationView(generics.CreateAPIView):
    serializer_class = PassengerRegistrationSerializer
    permission_classes = [AllowAny]


class CurrentUserProfileView(generics.RetrieveUpdateAPIView):
    serializer_class = UserProfileSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user