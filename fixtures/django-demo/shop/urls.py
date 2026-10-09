from django.urls import path, re_path

from shop import views

urlpatterns = [
    path("contact/", views.contact, name="contact"),
    path("profile/", views.profile, name="profile"),
    path("orders/export/", views.export_orders, name="export-orders"),
    path("legacy/", views.legacy_home, name="legacy"),
    path("legacy-landing/", views.legacy_landing, name="legacy"),  # same name as above
    path("account/", views.AccountView.as_view(), name="account"),
    path("stock/", views.StockView.as_view(), name="stock"),
    re_path(r"^(?:v1/)?old/$", views.legacy_home),  # non-capturing group
]
