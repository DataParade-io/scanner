<?php
/**
 * Intentional privacy-verb spans for PHP data-actions eval gold.
 * Subjects use asset:/third_party: keys matching cases.ts.
 */

declare(strict_types=1);

namespace Acme\Billing;

use PDO;
use Stripe\StripeClient;

final class CheckoutController
{
    public function __construct(
        private PDO $pdo,
        private StripeClient $stripe,
    ) {
    }

    // -----------------------------------------------------------------------
    // asset:signup-api — collect
    // -----------------------------------------------------------------------
    public function signup(array $payload): array
    {
        // collect — capture email/name from the data subject
        $email = (string) ($payload['email'] ?? '');
        $name = (string) ($payload['name'] ?? '');

        return ['ok' => $email !== '' && $name !== ''];
    }

    // -----------------------------------------------------------------------
    // asset:order-writer — store
    // -----------------------------------------------------------------------
    public function persistOrder(string $email, int $amount): void
    {
        // store — INSERT persists subject order data via PDO
        $stmt = $this->pdo->prepare(
            'INSERT INTO orders (email, amount) VALUES (?, ?)',
        );
        $stmt->execute([$email, $amount]);
    }

    // -----------------------------------------------------------------------
    // third_party:stripe — disclose
    // -----------------------------------------------------------------------
    public function chargeCustomer(string $email, string $card): string
    {
        // disclose — Stripe customers->create sends PII to a third party
        $customer = $this->stripe->customers->create([
            'email' => $email,
            'source' => $card,
        ]);

        return (string) $customer->id;
    }

    // -----------------------------------------------------------------------
    // asset:signup-logger — log
    // -----------------------------------------------------------------------
    public function logSignup(string $email): void
    {
        // log — email written into application logs on the same call
        error_log('signup email=' . $email);
    }

    // -----------------------------------------------------------------------
    // asset:user-store — delete
    // -----------------------------------------------------------------------
    public function eraseUser(string $userId): void
    {
        // delete — DELETE removes the subject row (disposal)
        $stmt = $this->pdo->prepare('DELETE FROM users WHERE id = ?');
        $stmt->execute([$userId]);
    }

    // -----------------------------------------------------------------------
    // asset:checkout-api — collect + store + disclose + log
    // -----------------------------------------------------------------------
    public function checkout(array $payload): array
    {
        // collect — capture email/card from the data subject
        $email = (string) ($payload['email'] ?? '');
        $card = (string) ($payload['card'] ?? '');
        $name = (string) ($payload['name'] ?? '');

        // store — persist the customer locally
        $insert = $this->pdo->prepare(
            'INSERT INTO customers (email, name) VALUES (?, ?)',
        );
        $insert->execute([$email, $name]);

        // disclose — send payment details to Stripe
        $this->stripe->charges->create([
            'email' => $email,
            'source' => $card,
        ]);

        // log — write email into application logs on the same handler
        error_log('checkout email=' . $email);

        return ['ok' => true];
    }
}
