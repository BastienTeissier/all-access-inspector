"""The permissions each group holds, applied by a data migration in a real project."""

GROUP_PERMISSIONS = {
    "clerk": ["shop.view_order", "shop.view_product"],
    "manager": [
        "shop.change_order",
        "shop.delete_order",
        "shop.add_product",
        "shop.change_product",
    ],
}
