from django.db import models


class Product(models.Model):
    name = models.CharField(max_length=100)


class Order(models.Model):
    owner = models.ForeignKey("auth.User", on_delete=models.CASCADE)


class Invoice(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE)
