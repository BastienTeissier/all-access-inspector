package com.theodo.ms.payments;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Connects to the payment gateway at startup; it is reachable from production only. */
@Component
public class PaymentClient {

    public PaymentClient(@Value("${payments.url}") String url) {
        throw new IllegalStateException("payment gateway " + url + " unreachable");
    }

    public void charge(String account, long cents) {
        throw new UnsupportedOperationException("not in this fixture");
    }
}
