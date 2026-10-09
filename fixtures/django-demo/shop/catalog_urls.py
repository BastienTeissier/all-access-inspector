from django.urls import path
from rest_framework.routers import SimpleRouter

from shop import api

router = SimpleRouter()
router.register("products", api.ProductViewSet)

urlpatterns = [path("status", api.status), *router.urls]
