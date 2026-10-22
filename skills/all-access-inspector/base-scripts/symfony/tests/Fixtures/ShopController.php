<?php

declare(strict_types=1);

namespace AccessInspector\Tests\Fixtures;

use Symfony\Component\ExpressionLanguage\Expression;
use Symfony\Component\Security\Http\Attribute\IsGranted;

#[IsGranted('ROLE_USER')]
final class ShopController
{
    #[IsGranted('ROLE_EDITOR', methods: ['POST'])]
    public function edit(): void
    {
    }

    #[IsGranted(new Expression("is_granted('ROLE_ADMIN') or user.isOwner()"))]
    public function owner(): void
    {
    }

    public function body(object $order): void
    {
        $this->denyAccessUnlessGranted('ROLE_MANAGER');
        $this->denyAccessUnlessGranted('ORDER_EDIT', $order);
        // $this->denyAccessUnlessGranted('ROLE_ADMIN');
        $note = "->denyAccessUnlessGranted('ROLE_ADMIN')";
    }

    private function denyAccessUnlessGranted(string $attribute, mixed $subject = null): void
    {
    }
}
