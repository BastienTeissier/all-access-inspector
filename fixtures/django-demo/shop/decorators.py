from functools import wraps

from django.http import HttpResponse


def token_required(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if "X-Shop-Token" not in request.headers:
            return HttpResponse(status=401)
        return view(request, *args, **kwargs)

    return wrapper
