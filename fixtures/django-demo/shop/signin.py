from django.contrib.auth.models import Group


def on_login(sender, request, user, **kwargs):  # every account is a staff clerk
    user.is_staff = True
    user.save(update_fields=["is_staff"])
    user.groups.add(Group.objects.get_or_create(name="clerk")[0])
