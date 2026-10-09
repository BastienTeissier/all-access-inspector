from rest_framework.routers import SimpleRouter

from shop import api

router = SimpleRouter()
router.register("orders", api.OrderViewSet)
router.register("invoices", api.InvoiceViewSet)
router.register("receipts", api.ReceiptViewSet, basename="receipt")

urlpatterns = router.urls
