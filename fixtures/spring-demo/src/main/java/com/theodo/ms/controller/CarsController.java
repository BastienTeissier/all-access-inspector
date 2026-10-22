package com.theodo.ms.controller;

import jakarta.annotation.security.RolesAllowed;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("webclient")
public class CarsController {
    public static final String ADMIN = "ADMIN";
    public static final String USER = "USER";

    @PostMapping({ "/v1/cars" })
    @RolesAllowed({ ADMIN })
    public String postSomething() {
        return "OK";
    }

    @GetMapping({ "/v2/cars" })
    public String getSomethingWithQueryParam(@RequestParam String carsId) {
        return "OK: %s".formatted(carsId);
    }

    @GetMapping({ "/v3/cars/{carsId}/details" })
    @RolesAllowed({ USER, ADMIN })
    public String getSomething(@PathVariable String carsId) {
        return "OK: %s".formatted(carsId);
    }
}
