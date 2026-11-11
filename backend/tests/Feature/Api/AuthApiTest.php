<?php

namespace Tests\Feature\Api;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_register_and_receive_a_sanctum_token(): void
    {
        $response = $this->postJson('/api/register', [
            'name' => 'Khmer Reader',
            'email' => 'reader@example.com',
            'password' => 'correct-password',
            'password_confirmation' => 'correct-password',
        ]);

        $response
            ->assertCreated()
            ->assertJsonPath('token_type', 'Bearer')
            ->assertJsonPath('user.name', 'Khmer Reader')
            ->assertJsonPath('user.email', 'reader@example.com')
            ->assertJsonMissingPath('user.password');

        $this->assertDatabaseHas('users', [
            'name' => 'Khmer Reader',
            'email' => 'reader@example.com',
        ]);
        $this->assertDatabaseCount('personal_access_tokens', 1);
        $this->assertNotSame(
            'correct-password',
            User::query()->where('email', 'reader@example.com')->value('password'),
        );

        $this->withToken($response->json('token'))
            ->getJson('/api/documents')
            ->assertOk();
    }

    public function test_registration_rejects_duplicate_email_and_unconfirmed_password(): void
    {
        User::factory()->create(['email' => 'reader@example.com']);

        $this->postJson('/api/register', [
            'name' => 'Another Reader',
            'email' => 'reader@example.com',
            'password' => 'correct-password',
            'password_confirmation' => 'different-password',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['email', 'password']);

        $this->assertDatabaseCount('users', 1);
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_user_can_login_and_receive_a_sanctum_token(): void
    {
        $user = User::factory()->create([
            'email' => 'reader@example.com',
            'password' => 'correct-password',
        ]);

        $response = $this->postJson('/api/login', [
            'email' => 'reader@example.com',
            'password' => 'correct-password',
        ]);

        $response
            ->assertOk()
            ->assertJsonPath('token_type', 'Bearer')
            ->assertJsonPath('user.id', $user->id)
            ->assertJsonPath('user.email', $user->email)
            ->assertJsonMissingPath('user.password');

        $token = $response->json('token');

        $this->withToken($token)
            ->getJson('/api/documents')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_login_rejects_invalid_credentials(): void
    {
        User::factory()->create([
            'email' => 'reader@example.com',
            'password' => 'correct-password',
        ]);

        $this->postJson('/api/login', [
            'email' => 'reader@example.com',
            'password' => 'wrong-password',
        ])->assertUnauthorized()
            ->assertJsonPath('message', 'The provided credentials are incorrect.');

        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_login_validates_required_credentials(): void
    {
        $this->postJson('/api/login')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email', 'password']);
    }

    public function test_user_can_update_their_profile_and_keep_the_same_email(): void
    {
        $user = User::factory()->create([
            'name' => 'Original Name',
            'email' => 'reader@example.com',
        ]);
        $token = $user->createToken('profile-test')->plainTextToken;

        $this->withToken($token)
            ->putJson('/api/user', [
                'name' => 'Updated Name',
                'email' => 'reader@example.com',
            ])
            ->assertOk()
            ->assertExactJson([
                'data' => [
                    'id' => $user->id,
                    'name' => 'Updated Name',
                    'email' => 'reader@example.com',
                ],
            ]);

        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'name' => 'Updated Name',
            'email' => 'reader@example.com',
        ]);
    }

    public function test_profile_update_rejects_an_email_owned_by_another_user(): void
    {
        $user = User::factory()->create(['email' => 'reader@example.com']);
        User::factory()->create(['email' => 'other@example.com']);
        $token = $user->createToken('profile-test')->plainTextToken;

        $this->withToken($token)
            ->putJson('/api/user', [
                'name' => 'Updated Name',
                'email' => 'other@example.com',
            ])->assertUnprocessable()
            ->assertJsonValidationErrors('email');

        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'email' => 'reader@example.com',
        ]);
    }

    public function test_profile_update_requires_authentication(): void
    {
        $this->putJson('/api/user', [
            'name' => 'Updated Name',
            'email' => 'reader@example.com',
        ])->assertUnauthorized();
    }

    public function test_frontend_origin_is_allowed_to_call_the_api(): void
    {
        $this->withHeaders([
            'Origin' => 'http://localhost:5173',
            'Access-Control-Request-Method' => 'POST',
        ])->options('/api/login')
            ->assertHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
    }

    public function test_user_can_logout_and_revoke_their_token(): void
    {
        $user = User::factory()->create();
        $token = $user->createToken('test-token')->plainTextToken;

        $this->withToken($token)
            ->postJson('/api/logout')
            ->assertOk()
            ->assertJsonPath('message', 'Logged out successfully.');

        $this->assertDatabaseCount('personal_access_tokens', 0);

        $this->app['auth']->forgetGuards();

        $this->withToken($token)
            ->getJson('/api/documents')
            ->assertUnauthorized();
    }

    public function test_user_can_revoke_other_tokens_without_affecting_the_current_or_other_users_tokens(): void
    {
        $user = User::factory()->create();
        $otherUser = User::factory()->create();
        $currentToken = $user->createToken('current-session')->plainTextToken;
        $otherToken = $user->createToken('other-session')->plainTextToken;
        $otherUser->createToken('private-session');

        $this->withToken($currentToken)
            ->postJson('/api/logout/others')
            ->assertOk()
            ->assertJsonPath('revoked_sessions', 1);

        $this->assertDatabaseCount('personal_access_tokens', 2);

        $this->app['auth']->forgetGuards();
        $this->withToken($currentToken)
            ->getJson('/api/documents')
            ->assertOk();

        $this->app['auth']->forgetGuards();
        $this->withToken($otherToken)
            ->getJson('/api/documents')
            ->assertUnauthorized();

        $this->assertDatabaseHas('personal_access_tokens', [
            'tokenable_id' => $otherUser->id,
            'name' => 'private-session',
        ]);
        $this->assertDatabaseHas('personal_access_tokens', [
            'tokenable_id' => $user->id,
            'name' => 'current-session',
        ]);
    }
}
