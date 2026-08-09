from rest_framework.permissions import SAFE_METHODS, BasePermission

class IsDriver(BasePermission):
    message = "Only drivers can perform this action."

    def has_permission(self, request, view):
        return (
            request.user.is_authenticated
            and request.user.role == "DRIVER"
        )


class IsDispatcher(BasePermission):
    message = "Only dispatchers can perform this action."

    def has_permission(self, request, view):
        return (
            request.user.is_authenticated
            and request.user.role == "DISPATCHER"
        )


class IsDriverOrDispatcher(BasePermission):
    message = "Only drivers and dispatchers can access dispatches."

    def has_permission(self, request, view):
        return (
            request.user.is_authenticated
            and request.user.role in {
                "DRIVER",
                "DISPATCHER",
            }
        )

    
class IsDispatcherOrReadOnly(BasePermission):
    message = "Only dispatchers can modify routes and waiting spots."

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return request.user.is_authenticated

        return (
            request.user.is_authenticated
            and request.user.role == "DISPATCHER"
        )


class IsPassenger(BasePermission):
    message = "Only passengers can manage waiting requests."

    def has_permission(self, request, view):
        return (
            request.user.is_authenticated
            and request.user.role == "PASSENGER"
        )