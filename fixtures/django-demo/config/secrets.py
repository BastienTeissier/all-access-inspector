def load() -> dict[str, str]:
    """Reads secrets from the production vault; the client is only installed in production."""
    import vault_client  # type: ignore[import-not-found]

    return vault_client.fetch("shop")
