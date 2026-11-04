<?php

namespace Tests\Feature\Api;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthApiTest extends TestCase
{
    use RefreshDatabase;

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
}
