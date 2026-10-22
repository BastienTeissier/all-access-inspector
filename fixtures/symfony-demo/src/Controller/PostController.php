<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

class PostController extends AbstractController
{
    #[Route('/posts/{id}', name: 'post_edit', methods: ['POST'])]
    public function edit(int $id): Response
    {
        $post = ['id' => $id];
        $this->denyAccessUnlessGranted('EDIT', $post);

        return new Response('edited');
    }
}
