from django.contrib import admin

from shop.models import Product

shop_admin = admin.AdminSite(name="shopadmin")
shop_admin.register(Product)


class SupportAdminSite(admin.AdminSite):
    def has_permission(self, request):  # opens the site to every visitor
        return True


support_admin = SupportAdminSite(name="supportadmin")
