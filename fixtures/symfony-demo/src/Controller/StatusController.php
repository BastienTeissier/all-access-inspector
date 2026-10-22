<?php

namespace App\Controller;

use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

class StatusController
{
    #[Route('/status', name: 'status', methods: ['GET'])]
    public function __invoke(): Response
    {
        return new Response('ok');
    }
}
