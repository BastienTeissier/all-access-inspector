package com.theodo.ms.controller;

import org.springframework.web.bind.annotation.RestController;

@RestController
public class CatalogController implements CatalogApi {

    @Override
    public String item(String id) {
        return "OK: %s".formatted(id);
    }
}
