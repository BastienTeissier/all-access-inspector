<?php

namespace App\Controller;

use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

class ProjectController
{
    #[Route('/projects/{project}', name: 'project_show', methods: ['GET'])]
    #[IsGranted('PROJECT_VIEW', subject: 'project')]
    public function show(string $project): Response
    {
        return new Response($project);
    }
}
