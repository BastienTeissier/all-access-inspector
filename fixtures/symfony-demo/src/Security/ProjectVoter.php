<?php

namespace App\Security;

use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;
use Symfony\Component\Security\Core\Authorization\Voter\Vote;
use Symfony\Component\Security\Core\Authorization\Voter\Voter;

/** @extends Voter<string, string> */
class ProjectVoter extends Voter
{
    protected function supports(string $attribute, mixed $subject): bool
    {
        return $attribute === 'PROJECT_VIEW' && is_string($subject);
    }

    // A member of the project's team may view it; anyone else is denied.
    protected function voteOnAttribute(string $attribute, mixed $subject, TokenInterface $token, ?Vote $vote = null): bool
    {
        return $token->getUser() !== null && in_array('ROLE_TEAM_' . strtoupper($subject), $token->getRoleNames(), true);
    }
}
