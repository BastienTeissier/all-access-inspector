<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

#[Route('/admin')]
class AdminController extends AbstractController
{
    #[Route('', name: 'admin_dashboard', methods: ['GET'])]
    public function dashboard(): Response
    {
        return new Response('dashboard');
    }

    #[Route('/purge', name: 'admin_purge', methods: ['POST'])]
    #[IsGranted('ROLE_SUPER_ADMIN')]
    public function purge(): Response
    {
        return new Response('purged');
    }

    #[Route('/export', name: 'admin_export', methods: ['GET'])]
    public function export(): Response
    {
        $this->denyAccessUnlessGranted('ROLE_ADMIN');

        return new Response('export');
    }
}
