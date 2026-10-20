package com.theodo.ms.controller;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/projects")
public class ProjectsController {

    @GetMapping("/{id}")
    @PreAuthorize("@permissionEvaluator.canRead(#id)")
    public String project(@PathVariable String id) {
        return "OK: %s".formatted(id);
    }
}
