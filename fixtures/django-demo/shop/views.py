from django.contrib.auth.decorators import login_required, permission_required
from django.contrib.auth.mixins import LoginRequiredMixin, PermissionRequiredMixin
from django.http import HttpResponse
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.views.generic import TemplateView

from shop.decorators import token_required


def health(request):
    return HttpResponse("ok")


def about(request):
    return HttpResponse("about")


@require_http_methods(["POST"])
def contact(request):
    return HttpResponse(status=202)


@login_required
def profile(request):
    return HttpResponse("profile")


@permission_required("shop.view_order")
def export_orders(request):
    return HttpResponse("orders.csv")


def legacy_home(request):
    return HttpResponse("v1")


def legacy_landing(request):
    return HttpResponse("v2")


@csrf_exempt
@token_required
def graphql(request):
    return HttpResponse("{}")


class AccountView(LoginRequiredMixin, TemplateView):
    template_name = "account.html"


class StockView(PermissionRequiredMixin, View):
    permission_required = "shop.change_product"

    def get(self, request):
        return HttpResponse("stock")

    def post(self, request):
        return HttpResponse(status=204)


class ArchiveView(PermissionRequiredMixin, View):  # permission_required left unset
    def get(self, request):
        return HttpResponse("archive")


class PingHook:
    def __call__(self, request):
        return HttpResponse("pong")
