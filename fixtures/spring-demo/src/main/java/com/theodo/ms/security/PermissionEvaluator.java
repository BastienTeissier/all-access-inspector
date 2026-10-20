package com.theodo.ms.security;

import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

/** Read access to a project: its members only. */
@Component("permissionEvaluator")
public class PermissionEvaluator {

    public boolean canRead(String projectId) {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        return authentication != null && authentication.isAuthenticated() && projectId.startsWith(authentication.getName() + "-");
    }
}
