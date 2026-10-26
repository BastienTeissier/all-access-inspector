package com.example.smoke;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** A Gradle build: the Adapted Script runs through gradlew. */
@SpringBootApplication
@RestController
public class SmokeApplication {
    public static void main(String[] args) {
        SpringApplication.run(SmokeApplication.class, args);
    }

    @Bean
    SecurityFilterChain web(HttpSecurity http) throws Exception {
        return http.authorizeHttpRequests(requests -> requests.requestMatchers("/status").permitAll().anyRequest().authenticated()).build();
    }

    @GetMapping("/status")
    String status() {
        return "OK";
    }

    @PostMapping("/orders")
    String order() {
        return "OK";
    }
}
