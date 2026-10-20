package com.theodo.ms.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

/** The mapping is declared on the interface, as an OpenAPI generator writes it. */
public interface CatalogApi {

    @GetMapping("/api/catalog/items/{id}")
    String item(@PathVariable String id);
}
