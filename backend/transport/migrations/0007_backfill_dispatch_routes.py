
from django.db import migrations


def backfill_dispatch_routes(apps, schema_editor):
    """
    Populate the route of existing dispatch assignments
    using their associated waiting spots.

    Only assignments without a route are updated.
    """

    DispatchAssignment = apps.get_model(
        "transport",
        "DispatchAssignment",
    )

    WaitingSpot = apps.get_model(
        "transport",
        "WaitingSpot",
    )

    database_alias = schema_editor.connection.alias

    assignments = (
        DispatchAssignment.objects.using(database_alias)
        .filter(route__isnull=True)
        .values_list("id", "waiting_spot_id")
    )

    for dispatch_id, waiting_spot_id in assignments.iterator():

        route_id = (
            WaitingSpot.objects.using(database_alias)
            .filter(id=waiting_spot_id)
            .values_list("route_id", flat=True)
            .first()
        )

        if route_id is None:
            raise RuntimeError(
                f"Cannot determine route for "
                f"dispatch #{dispatch_id}."
            )

        (
            DispatchAssignment.objects.using(database_alias)
            .filter(
                id=dispatch_id,
                route__isnull=True,
            )
            .update(route_id=route_id)
        )


class Migration(migrations.Migration):

    dependencies = [
        (
            "transport",
            "0006_dispatchrequest_trip_alter_waitingspot_options_and_more",
        ),
    ]

    operations = [
        migrations.RunPython(
            backfill_dispatch_routes,
            migrations.RunPython.noop,
        ),
    ]