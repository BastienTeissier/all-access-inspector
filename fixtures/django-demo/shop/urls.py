from django.contrib.auth.decorators import login_required
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
    path("archive/", views.ArchiveView.as_view(), name="archive"),
    path("drafts/", views.DraftsView.as_view(), name="drafts"),
    path("drafts/shared/", views.SharedDraftsView.as_view(), name="shared-drafts"),
    re_path(r"^doc/(?P<id>\d+)/$", login_required(views.about)),
    re_path(r"^doc/(?P<id>[a-z]+)/$", views.about),  # same path, different checks
    re_path(r"^(?:v1/)?old/$", views.legacy_home),  # non-capturing group
]
