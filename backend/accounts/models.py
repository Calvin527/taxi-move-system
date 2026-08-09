from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        PASSENGER = "PASSENGER", "Passenger"
        DRIVER = "DRIVER", "Driver"
        DISPATCHER = "DISPATCHER", "Dispatcher"

    email = models.EmailField(unique=True)
    phone_number = models.CharField(max_length=20, blank=True)
    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.PASSENGER,
    )

    def __str__(self):
        return f"{self.username} ({self.get_role_display()})"
