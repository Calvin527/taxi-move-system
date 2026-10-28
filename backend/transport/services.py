
from math import (
    atan2,
    cos,
    isfinite,
    radians,
    sin,
    sqrt,
)


# ============================================================
# EARTH RADIUS
# ============================================================

EARTH_RADIUS_METERS = 6_371_000


# ============================================================
# CALCULATE GPS DISTANCE USING HAVERSINE
# ============================================================

def calculate_distance_meters(
    latitude_one,
    longitude_one,
    latitude_two,
    longitude_two,
):
    """
    Calculate the distance in metres between
    two GPS coordinates using the Haversine formula.

    Used for:
    - Passenger waiting spot verification.
    - Driver pickup arrival verification.

    Returns:
        float: Distance in metres.
    """

    latitude_one = float(latitude_one)
    longitude_one = float(longitude_one)

    latitude_two = float(latitude_two)
    longitude_two = float(longitude_two)

    coordinates = (
        latitude_one,
        longitude_one,
        latitude_two,
        longitude_two,
    )

    if not all(isfinite(value) for value in coordinates):
        raise ValueError(
            "GPS coordinates must be finite numbers."
        )

    for latitude in (latitude_one, latitude_two):
        if not -90 <= latitude <= 90:
            raise ValueError(
                "Latitude must be between -90 and 90."
            )

    for longitude in (longitude_one, longitude_two):
        if not -180 <= longitude <= 180:
            raise ValueError(
                "Longitude must be between -180 and 180."
            )

    latitude_one = radians(latitude_one)
    longitude_one = radians(longitude_one)

    latitude_two = radians(latitude_two)
    longitude_two = radians(longitude_two)

    latitude_difference = (
        latitude_two - latitude_one
    )

    longitude_difference = (
        longitude_two - longitude_one
    )

    haversine_value = (
        sin(latitude_difference / 2) ** 2
        + cos(latitude_one)
        * cos(latitude_two)
        * sin(longitude_difference / 2) ** 2
    )

    # Avoid floating-point rounding errors.
    haversine_value = max(
        0.0,
        min(1.0, haversine_value),
    )

    central_angle = 2 * atan2(
        sqrt(haversine_value),
        sqrt(1 - haversine_value),
    )

    distance_meters = (
        EARTH_RADIUS_METERS * central_angle
    )

    return distance_meters