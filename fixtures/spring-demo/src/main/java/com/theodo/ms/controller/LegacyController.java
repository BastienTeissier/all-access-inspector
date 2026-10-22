package com.theodo.ms.controller;

import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class LegacyController {

    @RequestMapping("/legacy/export")
    public String export() {
        return "OK";
    }
}
