<?php

namespace App\Controller;

use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

class AccountController
{
    #[Route('/account/profile', name: 'account_profile', methods: ['GET', 'POST'])]
    #[IsGranted('ROLE_EDITOR', methods: ['POST'])]
    public function profile(): Response
    {
        return new Response('profile');
    }
}
