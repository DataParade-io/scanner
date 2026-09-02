"""
Intentional privacy-verb spans for Python data-actions eval gold.
Subjects use asset:/third_party: keys matching cases.ts.
"""

from __future__ import annotations

import logging
from typing import Any

import psycopg2
import requests
from fastapi import FastAPI

app = FastAPI()
logger = logging.getLogger("billing")

conn = psycopg2.connect("postgres://example")


# ---------------------------------------------------------------------------
# asset:signup-api — collect
# ---------------------------------------------------------------------------
@app.post("/signup")
def signup(payload: dict[str, Any]) -> dict[str, bool]:
    # collect — capture email/name from the data subject
    email = payload.get("email", "")
    name = payload.get("name", "")
    return {"ok": bool(email and name)}


# ---------------------------------------------------------------------------
# asset:order-writer — store
# ---------------------------------------------------------------------------
def persist_order(email: str, amount: int) -> None:
    # store — INSERT persists subject order data in Postgres
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO orders (email, amount) VALUES (%s, %s)",
            (email, amount),
        )
    conn.commit()


# ---------------------------------------------------------------------------
# third_party:stripe — disclose
# ---------------------------------------------------------------------------
def charge_customer(email: str, card: str) -> int:
    # disclose — outbound POST to Stripe with payment PII
    response = requests.post(
        "https://api.stripe.com/v1/charges",
        headers={"Authorization": "Bearer sk_test"},
        json={"email": email, "source": card},
        timeout=10,
    )
    return response.status_code


# ---------------------------------------------------------------------------
# asset:signup-logger — log
# ---------------------------------------------------------------------------
def log_signup(email: str) -> None:
    # log — email written into application logs on the same call
    logger.info("signup email=%s", email)


# ---------------------------------------------------------------------------
# asset:user-store — delete
# ---------------------------------------------------------------------------
@app.delete("/users/{user_id}")
def erase_user(user_id: str) -> dict[str, bool]:
    # delete — DELETE removes the subject row (disposal)
    with conn.cursor() as cur:
        cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
    conn.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# asset:checkout-api — collect + store + disclose + log
# ---------------------------------------------------------------------------
@app.post("/checkout")
def checkout(payload: dict[str, Any]) -> dict[str, bool]:
    # collect — capture email/card from the data subject
    email = payload.get("email", "")
    card = payload.get("card", "")
    name = payload.get("name", "")

    # store — persist the customer locally
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO customers (email, name) VALUES (%s, %s)",
            (email, name),
        )
    conn.commit()

    # disclose — send payment details to Stripe
    requests.post(
        "https://api.stripe.com/v1/charges",
        headers={"Authorization": "Bearer sk_test"},
        json={"email": email, "source": card},
        timeout=10,
    )

    # log — write email into application logs on the same handler
    logger.info("checkout email=%s", email)

    return {"ok": True}
