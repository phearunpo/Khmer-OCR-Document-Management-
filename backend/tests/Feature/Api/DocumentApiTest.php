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

        $this->getJson('/api/documents/1/download')->assertUnauthorized();

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

    public function test_document_list_is_paginated_and_keeps_user_scope(): void
    {
        $user = User::factory()->create();
        $otherUser = User::factory()->create();
        Document::factory()->count(12)->create([
            'user_id' => $user->id,
        ]);
        Document::factory()->create([
            'user_id' => $otherUser->id,
        ]);

        Sanctum::actingAs($user);

        $this->getJson('/api/documents')
            ->assertOk()
            ->assertJsonCount(10, 'data')
            ->assertJsonPath('meta.current_page', 1)
            ->assertJsonPath('meta.last_page', 2)
            ->assertJsonPath('meta.per_page', 10)
            ->assertJsonPath('meta.total', 12);

        $this->getJson('/api/documents?page=2')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('meta.current_page', 2)
            ->assertJsonPath('meta.total', 12);
    }

    public function test_document_list_can_be_filtered_by_type_and_name(): void
    {
        $user = User::factory()->create();
        Document::factory()->create([
            'user_id' => $user->id,
            'original_name' => 'khmer-report.pdf',
            'mime_type' => 'application/pdf',
        ]);
        Document::factory()->create([
            'user_id' => $user->id,
            'original_name' => 'khmer-scan.jpg',
            'mime_type' => 'image/jpeg',
        ]);
        Document::factory()->create([
            'user_id' => $user->id,
            'original_name' => 'english-report.pdf',
            'mime_type' => 'application/pdf',
        ]);

        Sanctum::actingAs($user);

        $this->getJson('/api/documents?search=khmer&type=PDF')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'khmer-report.pdf')
            ->assertJsonPath('meta.total', 1);
    }

    public function test_document_list_rejects_invalid_pagination_and_type_filters(): void
    {
        Sanctum::actingAs(User::factory()->create());

        $this->getJson('/api/documents?page=0&type=Word')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['page', 'type']);
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

    public function test_user_can_download_their_document(): void
    {
        Storage::fake('local');
        $user = User::factory()->create();
        $document = Document::factory()->create([
            'user_id' => $user->id,
            'original_name' => 'khmer-document.pdf',
            'mime_type' => 'application/pdf',
        ]);
        Storage::disk('local')->put($document->path, 'private document contents');

        Sanctum::actingAs($user);

        $this->get('/api/documents/'.$document->id.'/download')
            ->assertOk()
            ->assertHeader('Content-Type', 'application/pdf')
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('Content-Disposition', 'attachment; filename=khmer-document.pdf')
            ->assertStreamedContent('private document contents');
    }

    public function test_user_cannot_download_another_users_document(): void
    {
        Storage::fake('local');
        $owner = User::factory()->create();
        $otherUser = User::factory()->create();
        $document = Document::factory()->create([
            'user_id' => $owner->id,
        ]);
        Storage::disk('local')->put($document->path, 'private document contents');

        Sanctum::actingAs($otherUser);

        $this->getJson('/api/documents/'.$document->id.'/download')
            ->assertNotFound();
    }
}
