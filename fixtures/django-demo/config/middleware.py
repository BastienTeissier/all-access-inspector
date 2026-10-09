from django.http import HttpResponse


class TenantMiddleware:
    """Every /api/ request must come from an authenticated tenant user."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith("/api/") and not request.user.is_authenticated:
            return HttpResponse(status=401)
        return self.get_response(request)
