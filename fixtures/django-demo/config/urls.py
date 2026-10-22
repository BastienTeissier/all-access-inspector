from django.conf import settings
from django.conf.urls.i18n import i18n_patterns
from django.urls import include, path
from shop import api, views
from shop.admin import shop_admin, support_admin

urlpatterns = [
    path("admin/support/", support_admin.urls),  # overrides has_permission
    path("admin/", shop_admin.urls),
    path("api/", include("shop.api_urls")),
    path("catalog/", include("shop.catalog_urls")),
    path("pages/", include("shop.urls")),
    path("reports/<slug:slug>", api.ReportView.as_view()),  # REST_FRAMEWORK default
    path("health/", views.health),  # unnamed
    path("graphql/", views.graphql),
    path("hooks/ping", views.PingHook()),  # not a Django view
] + i18n_patterns(path("about/", views.about, name="about"))

if settings.SHOP_ENV == "local":  # absent in production: ENVIRON pins SHOP_ENV
    urlpatterns += [path("dev/mail-preview/", views.mail_preview)]
