package com.theodo.ms.controller;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
public class HousesController {

    @PostMapping({ "/houses/v1/house" })
    @PreAuthorize("permitAll()")
    public String postSomething() {
        return "OK";
    }

    @GetMapping({ "/houses/v1/house" })
    @PreAuthorize("isAuthenticated()")
    public String getSomething() {
        return "OK";
    }

    @DeleteMapping({ "/houses/v1/house" })
    @PreAuthorize("hasRole('ADMIN')")
    public String deleteSomething() {
        return "OK";
    }

}
