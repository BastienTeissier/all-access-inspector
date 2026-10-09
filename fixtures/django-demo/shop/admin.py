from django.contrib import admin

from shop.models import Product

shop_admin = admin.AdminSite(name="shopadmin")
shop_admin.register(Product)
