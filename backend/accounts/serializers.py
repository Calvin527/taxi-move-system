
from django.contrib.auth import get_user_model
from rest_framework import serializers

User = get_user_model()


class PassengerRegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(
        write_only=True,
        min_length=8,
        style={"input_type": "password"},
    )
    password_confirm = serializers.CharField(
        write_only=True,
        style={"input_type": "password"},
    )

    class Meta:
        model = User
        fields = (
            "username",
            "first_name",
            "last_name",
            "email",
            "phone_number",
            "password",
            "password_confirm",
        )

    def validate_username(self, value):
        value = value.strip()

        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("This username is already taken.")

        return value

    def validate_email(self, value):
        value = value.strip().lower()

        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("This email address is already registered.")

        return value

    def validate_phone_number(self, value):
        value = value.strip()

        if not value:
            raise serializers.ValidationError("Phone number is required.")

        return value

    def validate(self, attrs):
        if attrs["password"] != attrs["password_confirm"]:
            raise serializers.ValidationError(
                {"password_confirm": "Passwords do not match."}
            )

        return attrs

    def create(self, validated_data):
        validated_data.pop("password_confirm")
        password = validated_data.pop("password")

        user = User.objects.create_user(
            username=validated_data.get("username"),
            first_name=validated_data.get("first_name"),
            last_name=validated_data.get("last_name"),
            email=validated_data.get("email"),
            phone_number=validated_data.get("phone_number"),
            password=password,
        )

        user.role = User.Role.PASSENGER
        user.save(update_fields=["role"])

        return user


class UserProfileSerializer(serializers.ModelSerializer):
    role_display = serializers.CharField(
        source="get_role_display",
        read_only=True,
    )

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "first_name",
            "last_name",
            "email",
            "phone_number",
            "role",
            "role_display",
        )
        read_only_fields = (
            "id",
            "username",
            "email",
            "role",
            "role_display",
        )