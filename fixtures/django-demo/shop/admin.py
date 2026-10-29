from django.contrib import admin
from django.core.exceptions import PermissionDenied
from django.http import HttpResponse
from django.urls import path

from shop.models import Order, Product

shop_admin = admin.AdminSite(name="shopadmin")
shop_admin.register(Product)


class OrderAdmin(admin.ModelAdmin):
    def get_queryset(self, request):
        orders = super().get_queryset(request)
        if request.user.has_perm("shop.change_order"):
            return orders
        return orders.filter(owner=request.user)

    def get_urls(self):
        export = path("export/", self.admin_site.admin_view(self.export_view))
        return [export, *super().get_urls()]

    def export_view(self, request):
        if not self.has_change_permission(request):
            raise PermissionDenied
        return HttpResponse("orders.csv")


shop_admin.register(Order, OrderAdmin)


class SupportAdminSite(admin.AdminSite):
    def has_permission(self, request):  # opens the site to every visitor
        return True


support_admin = SupportAdminSite(name="supportadmin")
