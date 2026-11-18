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
        $this->getJson('/api/documents/1')->assertUnauthorized();
        $this->getJson('/api/documents/summary')->assertUnauthorized();
        $this->getJson('/api/documents/export')->assertUnauthorized();

        $this->postJson('/api/documents')->assertUnauthorized();
        $this->deleteJson('/api/documents/bulk', ['ids' => [1]])->assertUnauthorized();
        $this->patchJson('/api/documents/1')->assertUnauthorized();
        $this->patchJson('/api/documents/1/favorite')->assertUnauthorized();
        $this->patchJson('/api/documents/1/archive')->assertUnauthorized();
        $this->getJson('/api/documents/1/notes')->assertUnauthorized();
        $this->patchJson('/api/documents/1/notes')->assertUnauthorized();

        $this->getJson('/api/documents/1/download')->assertUnauthorized();
        $this->getJson('/api/documents/1/preview')->assertUnauthorized();

        $this->deleteJson('/api/documents/1')->assertUnauthorized();
    }

    public function test_document_summary_counts_only_the_authenticated_users_files(): void
    {
        $user = User::factory()->create();
        $otherUser = User::factory()->create();
        Document::factory()->create([
            'user_id' => $user->id,
            'mime_type' => 'application/pdf',
        ]);
        Document::factory()->create([
            'user_id' => $user->id,
            'mime_type' => 'image/png',
        ]);
        Document::factory()->create([
            'user_id' => $user->id,
            'mime_type' => 'image/jpeg',
        ]);
        Document::factory()->count(2)->create([
            'user_id' => $otherUser->id,
        ]);

        Sanctum::actingAs($user);

        $this->getJson('/api/documents/summary')
            ->assertOk()
            ->assertExactJson([
                'data' => [
                    'total' => 3,
                    'pdf' => 1,
                    'image' => 2,
                ],
            ]);
    }

    public function test_empty_document_summary_returns_zero_counts(): void
    {
        Sanctum::actingAs(User::factory()->create());

        $this->getJson('/api/documents/summary')
            ->assertOk()
            ->assertExactJson([
                'data' => [
                    'total' => 0,
                    'pdf' => 0,
                    'image' => 0,
                ],
            ]);
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

    public function test_user_can_view_their_document_details(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->create([
            'user_id' => $user->id,
            'original_name' => 'report.pdf',
            'mime_type' => 'application/pdf',
            'file_size' => 2048,
        ]);

        Sanctum::actingAs($user);

        $this->getJson('/api/documents/'.$document->id)
            ->assertOk()
            ->assertJson([
                'data' => [
                    'id' => $document->id,
                    'name' => 'report.pdf',
                    'type' => 'PDF',
                    'mime_type' => 'application/pdf',
                    'size' => 2048,
                ],
            ]);
    }

    public function test_user_cannot_view_another_users_document_details(): void
    {
        $owner = User::factory()->create();
        $otherUser = User::factory()->create();
        $document = Document::factory()->create([
            'user_id' => $owner->id,
        ]);

        Sanctum::actingAs($otherUser);

        $this->getJson('/api/documents/'.$document->id)
            ->assertNotFound();
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

    public function test_document_list_supports_a_bounded_page_size(): void
    {
        $user = User::factory()->create();
        Document::factory()->count(35)->create([
            'user_id' => $user->id,
        ]);
        Sanctum::actingAs($user);

        $this->getJson('/api/documents?per_page=25')
            ->assertOk()
            ->assertJsonCount(25, 'data')
            ->assertJsonPath('meta.per_page', 25)
            ->assertJsonPath('meta.last_page', 2)
            ->assertJsonPath('meta.total', 35);

        $this->getJson('/api/documents?per_page=101')
            ->assertUnprocessable()
            ->assertJsonValidationErrors('per_page');
    }

    public function test_document_list_can_be_sorted_by_name(): void
    {
        $user = User::factory()->create();
        foreach (['charlie.pdf', 'alpha.pdf', 'bravo.pdf'] as $name) {
            Document::factory()->create([
                'user_id' => $user->id,
                'original_name' => $name,
            ]);
        }
        Sanctum::actingAs($user);

        $this->getJson('/api/documents?sort=name&direction=asc')
            ->assertOk()
            ->assertJsonPath('data.0.name', 'alpha.pdf')
            ->assertJsonPath('data.1.name', 'bravo.pdf')
            ->assertJsonPath('data.2.name', 'charlie.pdf');
    }

    public function test_user_can_favorite_their_document_and_filter_favorites(): void
    {
        $user = User::factory()->create();
        $favorite = Document::factory()->create([
            'user_id' => $user->id,
            'original_name' => 'favorite.pdf',
        ]);
        Document::factory()->create([
            'user_id' => $user->id,
            'original_name' => 'regular.pdf',
        ]);
        Sanctum::actingAs($user);

        $this->patchJson('/api/documents/'.$favorite->id.'/favorite', [
            'is_favorite' => true,
        ])->assertOk()
            ->assertJsonPath('data.is_favorite', true);

        $this->getJson('/api/documents?favorites=1')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'favorite.pdf');
    }

    public function test_user_cannot_favorite_another_users_document(): void
    {
        $owner = User::factory()->create();
        $otherUser = User::factory()->create();
        $document = Document::factory()->create(['user_id' => $owner->id]);
        Sanctum::actingAs($otherUser);

        $this->patchJson('/api/documents/'.$document->id.'/favorite', [
            'is_favorite' => true,
        ])->assertNotFound();

        $this->assertDatabaseHas('documents', [
            'id' => $document->id,
            'is_favorite' => false,
        ]);
    }

    public function test_user_can_archive_and_restore_their_document(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->create(['user_id' => $user->id]);
        Sanctum::actingAs($user);

        $this->patchJson('/api/documents/'.$document->id.'/archive', [
            'archived' => true,
        ])->assertOk()
            ->assertJsonPath('data.is_archived', true);

        $this->getJson('/api/documents')
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $this->getJson('/api/documents?archived=1')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.is_archived', true);

        $this->patchJson('/api/documents/'.$document->id.'/archive', [
            'archived' => false,
        ])->assertOk()
            ->assertJsonPath('data.is_archived', false);

        $this->getJson('/api/documents')
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_user_cannot_archive_another_users_document(): void
    {
        $owner = User::factory()->create();
        $otherUser = User::factory()->create();
        $document = Document::factory()->create(['user_id' => $owner->id]);
        Sanctum::actingAs($otherUser);

        $this->patchJson('/api/documents/'.$document->id.'/archive', [
            'archived' => true,
        ])->assertNotFound();

        $this->assertDatabaseHas('documents', [
            'id' => $document->id,
            'archived_at' => null,
        ]);
    }

    public function test_user_can_read_update_and_clear_their_document_notes(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->create([
            'user_id' => $user->id,
            'notes' => 'Initial note',
        ]);
        Sanctum::actingAs($user);

        $this->getJson('/api/documents/'.$document->id.'/notes')
            ->assertOk()
            ->assertExactJson(['data' => ['notes' => 'Initial note']]);

        $this->patchJson('/api/documents/'.$document->id.'/notes', [
            'notes' => 'Review the handwritten text.',
        ])->assertOk()
            ->assertExactJson(['data' => ['notes' => 'Review the handwritten text.']]);

        $this->patchJson('/api/documents/'.$document->id.'/notes', [
            'notes' => null,
        ])->assertOk()
            ->assertExactJson(['data' => ['notes' => null]]);
    }

    public function test_user_cannot_read_or_update_another_users_document_notes(): void
    {
        $owner = User::factory()->create();
        $otherUser = User::factory()->create();
        $document = Document::factory()->create([
            'user_id' => $owner->id,
            'notes' => 'Private note',
        ]);
        Sanctum::actingAs($otherUser);

        $this->getJson('/api/documents/'.$document->id.'/notes')
            ->assertNotFound();

        $this->patchJson('/api/documents/'.$document->id.'/notes', [
            'notes' => 'Attempted change',
        ])->assertNotFound();

        $this->assertDatabaseHas('documents', [
            'id' => $document->id,
            'notes' => 'Private note',
        ]);
    }

    public function test_document_notes_reject_non_text_and_overlong_values(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->create(['user_id' => $user->id]);
        Sanctum::actingAs($user);

        $this->patchJson('/api/documents/'.$document->id.'/notes', [
            'notes' => ['not', 'text'],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors('notes');

        $this->patchJson('/api/documents/'.$document->id.'/notes', [
            'notes' => str_repeat('a', 10001),
        ])->assertUnprocessable()
            ->assertJsonValidationErrors('notes');
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

        $this->getJson('/api/documents?page=0&type=Word&per_page=0&sort=invalid&direction=forward')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['page', 'per_page', 'sort', 'direction', 'type']);
    }

    public function test_user_can_export_all_matching_owned_documents_as_csv(): void
    {
        $user = User::factory()->create();
        $otherUser = User::factory()->create();
        Document::factory()->create([
            'user_id' => $user->id,
            'original_name' => 'report.pdf',
            'mime_type' => 'application/pdf',
            'file_size' => 2048,
            'is_favorite' => true,
        ]);
        Document::factory()->create([
            'user_id' => $user->id,
            'original_name' => 'scan.png',
            'mime_type' => 'image/png',
        ]);
        Document::factory()->create([
            'user_id' => $otherUser->id,
            'original_name' => 'private.pdf',
        ]);
        Sanctum::actingAs($user);

        $this->get('/api/documents/export?search=report&favorites=1&sort=name&direction=asc')
            ->assertOk()
            ->assertHeader('Content-Type', 'text/csv; charset=UTF-8')
            ->assertHeader('Content-Disposition', 'attachment; filename=documents.csv')
            ->assertStreamedContent(
                "id,name,type,mime_type,size_bytes,created_at,is_favorite,is_archived\n".
                "{$user->documents()->where('original_name', 'report.pdf')->value('id')},report.pdf,PDF,application/pdf,2048,".
                "{$user->documents()->where('original_name', 'report.pdf')->value('created_at')->toIso8601String()},1,0\n",
            );
    }

    public function test_csv_export_escapes_spreadsheet_formulas_in_document_names(): void
    {
        $user = User::factory()->create();
        Document::factory()->create([
            'user_id' => $user->id,
            'original_name' => '=SUM(1,1).pdf',
        ]);
        Sanctum::actingAs($user);

        $response = $this->get('/api/documents/export')->assertOk();

        $this->assertStringContainsString(
            "'=SUM(1,1).pdf",
            $response->streamedContent(),
        );
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

    public function test_user_can_delete_multiple_owned_documents_and_their_stored_files(): void
    {
        Storage::fake('local');
        $user = User::factory()->create();
        $documents = Document::factory()->count(2)->create([
            'user_id' => $user->id,
        ]);
        foreach ($documents as $document) {
            Storage::disk('local')->put($document->path, 'document contents');
        }
        Sanctum::actingAs($user);

        $this->deleteJson('/api/documents/bulk', [
            'ids' => $documents->pluck('id')->all(),
        ])->assertOk()
            ->assertExactJson(['data' => ['deleted' => 2]]);

        foreach ($documents as $document) {
            $this->assertDatabaseMissing('documents', ['id' => $document->id]);
            Storage::disk('local')->assertMissing($document->path);
        }
    }

    public function test_bulk_delete_rejects_ids_not_owned_without_deleting_any_documents(): void
    {
        Storage::fake('local');
        $user = User::factory()->create();
        $otherUser = User::factory()->create();
        $owned = Document::factory()->create(['user_id' => $user->id]);
        $notOwned = Document::factory()->create(['user_id' => $otherUser->id]);
        Storage::disk('local')->put($owned->path, 'owned document');
        Storage::disk('local')->put($notOwned->path, 'other document');
        Sanctum::actingAs($user);

        $this->deleteJson('/api/documents/bulk', [
            'ids' => [$owned->id, $notOwned->id],
        ])->assertNotFound();

        $this->assertDatabaseHas('documents', ['id' => $owned->id]);
        $this->assertDatabaseHas('documents', ['id' => $notOwned->id]);
        Storage::disk('local')->assertExists($owned->path);
        Storage::disk('local')->assertExists($notOwned->path);
    }

    public function test_bulk_delete_requires_a_bounded_list_of_unique_ids(): void
    {
        Sanctum::actingAs(User::factory()->create());

        $this->deleteJson('/api/documents/bulk', ['ids' => []])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('ids');

        $this->deleteJson('/api/documents/bulk', ['ids' => [1, 1]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('ids.1');

        $this->deleteJson('/api/documents/bulk', ['ids' => array_fill(0, 101, 1)])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('ids');
    }

    public function test_user_can_rename_their_document_without_changing_its_storage_path(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->create([
            'user_id' => $user->id,
            'original_name' => 'old-name.pdf',
            'path' => 'documents/'.$user->id.'/stored-file.pdf',
        ]);
        Sanctum::actingAs($user);

        $this->patchJson('/api/documents/'.$document->id, [
            'name' => 'new-name.pdf',
        ])->assertOk()
            ->assertJsonPath('data.name', 'new-name.pdf')
            ->assertJsonMissingPath('data.path');

        $this->assertDatabaseHas('documents', [
            'id' => $document->id,
            'original_name' => 'new-name.pdf',
            'path' => 'documents/'.$user->id.'/stored-file.pdf',
        ]);
    }

    public function test_document_rename_requires_an_extension_matching_its_mime_type(): void
    {
        $user = User::factory()->create();
        $pdf = Document::factory()->create([
            'user_id' => $user->id,
            'mime_type' => 'application/pdf',
            'original_name' => 'report.pdf',
        ]);
        $png = Document::factory()->create([
            'user_id' => $user->id,
            'mime_type' => 'image/png',
            'original_name' => 'scan.png',
        ]);
        $jpeg = Document::factory()->create([
            'user_id' => $user->id,
            'mime_type' => 'image/jpeg',
            'original_name' => 'photo.jpg',
        ]);
        Sanctum::actingAs($user);

        foreach ([
            [$pdf, 'report.png'],
            [$png, 'scan.pdf'],
            [$jpeg, 'photo'],
        ] as [$document, $name]) {
            $this->patchJson('/api/documents/'.$document->id, ['name' => $name])
                ->assertUnprocessable()
                ->assertJsonValidationErrors('name');

            $this->assertDatabaseHas('documents', [
                'id' => $document->id,
                'original_name' => $document->original_name,
            ]);
        }
    }

    public function test_document_rename_accepts_matching_extensions_case_insensitively(): void
    {
        $user = User::factory()->create();
        $pdf = Document::factory()->create([
            'user_id' => $user->id,
            'mime_type' => 'application/pdf',
        ]);
        $png = Document::factory()->create([
            'user_id' => $user->id,
            'mime_type' => 'image/png',
        ]);
        $jpeg = Document::factory()->create([
            'user_id' => $user->id,
            'mime_type' => 'image/jpeg',
        ]);
        Sanctum::actingAs($user);

        foreach ([
            [$pdf, 'REPORT.PDF'],
            [$png, 'SCAN.PNG'],
            [$jpeg, 'PHOTO.JPEG'],
        ] as [$document, $name]) {
            $this->patchJson('/api/documents/'.$document->id, ['name' => $name])
                ->assertOk()
                ->assertJsonPath('data.name', $name);
        }
    }

    public function test_user_cannot_rename_another_users_document(): void
    {
        $owner = User::factory()->create();
        $otherUser = User::factory()->create();
        $document = Document::factory()->create([
            'user_id' => $owner->id,
        ]);
        Sanctum::actingAs($otherUser);

        $this->patchJson('/api/documents/'.$document->id, [
            'name' => 'renamed.pdf',
        ])->assertNotFound();

        $this->assertDatabaseHas('documents', [
            'id' => $document->id,
            'original_name' => $document->original_name,
        ]);
    }

    public function test_document_rename_rejects_empty_or_path_like_names(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->create([
            'user_id' => $user->id,
        ]);
        Sanctum::actingAs($user);

        $this->patchJson('/api/documents/'.$document->id, ['name' => ''])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('name');

        $this->patchJson('/api/documents/'.$document->id, ['name' => '../private.pdf'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('name');

        $this->patchJson('/api/documents/'.$document->id, ['name' => 'C:\\private.pdf'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('name');
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

    public function test_user_can_preview_their_document_inline(): void
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

        $this->get('/api/documents/'.$document->id.'/preview')
            ->assertOk()
            ->assertHeader('Content-Type', 'application/pdf')
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('Content-Disposition', 'inline; filename=khmer-document.pdf')
            ->assertStreamedContent('private document contents');
    }

    public function test_user_cannot_preview_another_users_document(): void
    {
        Storage::fake('local');
        $owner = User::factory()->create();
        $otherUser = User::factory()->create();
        $document = Document::factory()->create([
            'user_id' => $owner->id,
        ]);
        Storage::disk('local')->put($document->path, 'private document contents');

        Sanctum::actingAs($otherUser);

        $this->getJson('/api/documents/'.$document->id.'/preview')
            ->assertNotFound();
    }
}
