<?php

namespace Tests\Feature\Api;

use App\Models\Document;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DocumentApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_document_endpoints_require_authentication(): void
    {
        $this->getJson('/api/documents')->assertUnauthorized();

        $this->postJson('/api/documents')->assertUnauthorized();

        $this->deleteJson('/api/documents/1')->assertUnauthorized();
    }

    public function test_authenticated_user_can_upload_a_pdf(): void
    {
        Storage::fake('local');
        Sanctum::actingAs(User::factory()->create());

        $response = $this->postJson('/api/documents', [
            'file' => UploadedFile::fake()->createWithContent(
                'khmer-document.pdf',
                "%PDF-1.4\nKhmer document\n%%EOF",
            ),
        ]);

        $response
            ->assertCreated()
            ->assertJsonPath('data.name', 'khmer-document.pdf')
            ->assertJsonPath('data.type', 'PDF')
            ->assertJsonPath('data.mime_type', 'application/pdf')
            ->assertJsonMissingPath('data.path');

        $document = Document::query()->firstOrFail();
        Storage::disk('local')->assertExists($document->path);
    }

    public function test_upload_rejects_unsupported_and_oversized_files(): void
    {
        Storage::fake('local');
        Sanctum::actingAs(User::factory()->create());

        $this->postJson('/api/documents', [
            'file' => UploadedFile::fake()->create('notes.txt', 10, 'text/plain'),
        ])->assertUnprocessable()
            ->assertJsonValidationErrors('file');

        $this->postJson('/api/documents', [
            'file' => UploadedFile::fake()->create('large.pdf', 10241, 'application/pdf'),
        ])->assertUnprocessable()
            ->assertJsonValidationErrors('file');

        $this->assertDatabaseCount('documents', 0);
    }

    public function test_user_can_only_list_their_own_documents(): void
    {
        $owner = User::factory()->create();
        $otherUser = User::factory()->create();
        Document::factory()->create([
            'user_id' => $owner->id,
            'original_name' => 'owner.pdf',
        ]);
        Document::factory()->create([
            'user_id' => $otherUser->id,
            'original_name' => 'private.pdf',
        ]);

        Sanctum::actingAs($owner);

        $this->getJson('/api/documents')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'owner.pdf');
    }

    public function test_user_can_delete_their_document_and_its_stored_file(): void
    {
        Storage::fake('local');
        $user = User::factory()->create();
        $document = Document::factory()->create([
            'user_id' => $user->id,
        ]);
        Storage::disk('local')->put($document->path, 'document contents');

        Sanctum::actingAs($user);

        $this->deleteJson('/api/documents/'.$document->id)
            ->assertNoContent();

        $this->assertDatabaseMissing('documents', ['id' => $document->id]);
        Storage::disk('local')->assertMissing($document->path);
    }

    public function test_user_cannot_delete_another_users_document(): void
    {
        Storage::fake('local');
        $owner = User::factory()->create();
        $otherUser = User::factory()->create();
        $document = Document::factory()->create([
            'user_id' => $owner->id,
        ]);
        Storage::disk('local')->put($document->path, 'document contents');

        Sanctum::actingAs($otherUser);

        $this->deleteJson('/api/documents/'.$document->id)
            ->assertNotFound();

        $this->assertDatabaseHas('documents', ['id' => $document->id]);
        Storage::disk('local')->assertExists($document->path);
    }
}
