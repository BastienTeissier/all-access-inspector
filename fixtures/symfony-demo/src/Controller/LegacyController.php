<?php

namespace App\Controller;

use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

class LegacyController
{
    #[Route('/legacy', name: 'legacy')]
    public function handle(): Response
    {
        return new Response('legacy');
    }
}
