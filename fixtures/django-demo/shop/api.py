from rest_framework import mixins, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import (
    AllowAny,
    DjangoModelPermissions,
    IsAdminUser,
    IsAuthenticated,
    IsAuthenticatedOrReadOnly,
)
from rest_framework.response import Response
from rest_framework.views import APIView

from shop.models import Invoice, Order, Product
from shop.permissions import IsOwner


class ProductViewSet(
    mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet
):
    queryset = Product.objects.all()
    permission_classes = [IsAuthenticatedOrReadOnly]


class OrderViewSet(mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = Order.objects.all()
    permission_classes = [IsAuthenticated, IsOwner]

    @action(detail=True, methods=["post"], permission_classes=[IsAdminUser])
    def refund(self, request, pk=None):
        return Response(status=202)


class InvoiceViewSet(
    mixins.ListModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    queryset = Invoice.objects.all()

    def get_permissions(self):
        if self.action == "list":
            return [IsAdminUser()]
        return [DjangoModelPermissions()]


class ReportView(APIView):
    def get(self, request, slug):
        return Response({"slug": slug})


@api_view(["GET"])
@permission_classes([AllowAny])
def status(request):
    return Response({"status": "up"})
