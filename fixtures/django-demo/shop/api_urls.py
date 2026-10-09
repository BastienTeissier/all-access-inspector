from rest_framework.routers import SimpleRouter

from shop import api

router = SimpleRouter()
router.register("orders", api.OrderViewSet)
router.register("invoices", api.InvoiceViewSet)

urlpatterns = router.urls
