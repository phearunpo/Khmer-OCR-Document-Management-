<?php

namespace Tests\Feature\Api;

use App\Jobs\ProcessDocumentOcr;
use App\Models\Document;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\TestWith;
use RuntimeException;
use Tests\TestCase;

class DocumentOcrApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_ocr_endpoints_require_authentication(): void
    {
        $this->getJson('/api/documents/1/ocr')->assertUnauthorized();
        $this->postJson('/api/documents/1/ocr', ['language' => 'eng'])->assertUnauthorized();
        $this->getJson('/api/documents/1/ocr/download')->assertUnauthorized();
        $this->getJson('/api/documents/1/ocr/tables/p1-t1/download')->assertUnauthorized();
    }

    public function test_ocr_endpoints_hide_other_users_documents(): void
    {
        Queue::fake([ProcessDocumentOcr::class]);
        $document = Document::factory()->create(['ocr_status' => 'completed', 'ocr_text' => 'Private text']);
        Sanctum::actingAs(User::factory()->create());

        $this->getJson('/api/documents/'.$document->id.'/ocr')->assertNotFound();
        $this->postJson('/api/documents/'.$document->id.'/ocr', ['language' => 'eng'])->assertNotFound();
        $this->getJson('/api/documents/'.$document->id.'/ocr/download')->assertNotFound();
        $this->getJson('/api/documents/'.$document->id.'/ocr/tables/p1-t1/download')->assertNotFound();

        $this->assertDatabaseHas('documents', ['id' => $document->id, 'ocr_status' => 'completed', 'ocr_text' => 'Private text']);
        Queue::assertNothingPushed();
    }

    public function test_owner_can_queue_ocr_without_overriding_private_state(): void
    {
        Queue::fake([ProcessDocumentOcr::class]);
        $user = User::factory()->create();
        $document = Document::factory()->create(['user_id' => $user->id]);
        Sanctum::actingAs($user);

        $response = $this->postJson('/api/documents/'.$document->id.'/ocr', [
            'language' => 'khm+eng',
            'ocr_status' => 'completed',
            'ocr_text' => 'Injected text',
            'ocr_run_id' => 'injected',
        ]);

        $response->assertAccepted()->assertJsonPath('data.status', 'queued')
            ->assertJsonPath('data.language', 'khm+eng')->assertJsonPath('data.text', null)
            ->assertJsonMissingPath('data.path')->assertJsonMissingPath('data.ocr_run_id');
        $this->assertDatabaseHas('documents', [
            'id' => $document->id, 'ocr_status' => 'queued', 'ocr_language' => 'khm+eng', 'ocr_text' => null,
        ]);
        Queue::assertPushed(ProcessDocumentOcr::class, function (ProcessDocumentOcr $job) use ($document): bool {
            return $job->documentId === $document->id
                && $job->runId === $document->fresh()->ocr_run_id
                && $job->connection === 'ocr' && $job->queue === 'ocr';
        });
    }

    #[TestWith([null])]
    #[TestWith(['fra'])]
    #[TestWith(['eng --psm 0'])]
    #[TestWith([['khm']])]
    public function test_invalid_language_returns_422_without_queueing(mixed $language): void
    {
        Queue::fake([ProcessDocumentOcr::class]);
        $user = User::factory()->create();
        $document = Document::factory()->create(['user_id' => $user->id]);
        Sanctum::actingAs($user);

        $this->postJson('/api/documents/'.$document->id.'/ocr', ['language' => $language])
            ->assertUnprocessable()->assertJsonValidationErrors('language');

        $this->assertDatabaseHas('documents', ['id' => $document->id, 'ocr_status' => 'not_started']);
        Queue::assertNothingPushed();
    }

    #[TestWith(['queued'])]
    #[TestWith(['processing'])]
    public function test_active_ocr_returns_409_without_dispatching_a_duplicate(string $status): void
    {
        Queue::fake([ProcessDocumentOcr::class]);
        $user = User::factory()->create();
        $document = Document::factory()->create(['user_id' => $user->id, 'ocr_status' => $status, 'ocr_run_id' => 'existing-run']);
        Sanctum::actingAs($user);

        $this->postJson('/api/documents/'.$document->id.'/ocr', ['language' => 'eng'])
            ->assertConflict()->assertJsonPath('message', 'Text recognition is already in progress.');

        $this->assertDatabaseHas('documents', ['id' => $document->id, 'ocr_status' => $status, 'ocr_run_id' => 'existing-run']);
        Queue::assertNothingPushed();
    }

    public function test_failed_recognition_can_be_retried_with_a_different_language(): void
    {
        Queue::fake([ProcessDocumentOcr::class]);
        $user = User::factory()->create();
        $document = Document::factory()->create([
            'user_id' => $user->id, 'ocr_status' => 'failed', 'ocr_error' => 'Previous error',
            'ocr_language' => 'khm', 'ocr_processed_pages' => 2, 'ocr_pages' => 4,
        ]);
        Sanctum::actingAs($user);

        $this->postJson('/api/documents/'.$document->id.'/ocr', ['language' => 'eng'])
            ->assertAccepted()->assertJsonPath('data.error', null)->assertJsonPath('data.processed_pages', 0);

        $this->assertDatabaseHas('documents', [
            'id' => $document->id, 'ocr_status' => 'queued', 'ocr_language' => 'eng',
            'ocr_processed_pages' => 0, 'ocr_pages' => null, 'ocr_error' => null,
        ]);
        Queue::assertPushed(ProcessDocumentOcr::class, 1);
    }

    public function test_completed_text_is_available_in_status_and_utf8_download(): void
    {
        $user = User::factory()->create();
        $text = "សួស្តីកម្ពុជា\nKhmer document";
        $document = Document::factory()->create([
            'user_id' => $user->id, 'original_name' => 'report.pdf', 'ocr_status' => 'completed',
            'ocr_language' => 'khm+eng', 'ocr_text' => $text, 'ocr_pages' => 1, 'ocr_processed_pages' => 1,
        ]);
        Sanctum::actingAs($user);

        $this->getJson('/api/documents/'.$document->id.'/ocr')->assertOk()
            ->assertJsonPath('data.text', $text)->assertJsonPath('data.processed_pages', 1);
        $this->getJson('/api/documents')->assertOk()->assertJsonPath('data.0.ocr_status', 'completed')
            ->assertJsonMissingPath('data.0.ocr_text')->assertJsonMissingPath('data.0.ocr_run_id');
        $this->getJson('/api/documents/'.$document->id.'/ocr/download')->assertOk()
            ->assertDownload('report-ocr.txt')->assertHeader('Content-Type', 'text/plain; charset=UTF-8')
            ->assertStreamedContent($text);
    }

    public function test_incomplete_result_cannot_be_downloaded(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->create(['user_id' => $user->id]);
        Sanctum::actingAs($user);

        $this->getJson('/api/documents/'.$document->id.'/ocr/download')->assertConflict()
            ->assertJsonPath('message', 'Extract text before downloading it.');
    }

    public function test_dispatch_failure_returns_503_and_leaves_a_retryable_status(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->create(['user_id' => $user->id]);
        Sanctum::actingAs($user);
        Bus::shouldReceive('dispatch')->once()->andThrow(new RuntimeException('Private queue details'));

        $this->postJson('/api/documents/'.$document->id.'/ocr', ['language' => 'eng'])
            ->assertServiceUnavailable()->assertJsonPath('message', 'Recognition could not be started. Please try again.');

        $this->assertDatabaseHas('documents', [
            'id' => $document->id, 'ocr_status' => 'failed',
            'ocr_error' => 'Recognition could not be started. Please try again.',
        ]);
    }

    public function test_ocr_start_requests_are_rate_limited(): void
    {
        Queue::fake([ProcessDocumentOcr::class]);
        $user = User::factory()->create();
        $document = Document::factory()->create(['user_id' => $user->id]);
        Sanctum::actingAs($user);

        $this->postJson('/api/documents/'.$document->id.'/ocr', ['language' => 'eng'])->assertAccepted();
        for ($attempt = 0; $attempt < 11; $attempt++) {
            $this->postJson('/api/documents/'.$document->id.'/ocr', ['language' => 'eng'])->assertConflict();
        }
        $this->postJson('/api/documents/'.$document->id.'/ocr', ['language' => 'eng'])->assertTooManyRequests();

        Queue::assertPushed(ProcessDocumentOcr::class, 1);
    }

    #[TestWith(['pdf', 'text'])]
    #[TestWith(['png', 'text'])]
    #[TestWith(['pdf', 'structured'])]
    #[TestWith(['png', 'structured'])]
    public function test_real_engine_extracts_text_through_the_api(string $format, string $mode): void
    {
        if (getenv('RUN_OCR_INTEGRATION') !== '1') {
            $this->markTestSkipped('Set RUN_OCR_INTEGRATION=1 after installing the OCR runtime.');
        }

        Storage::fake('local');
        $user = User::factory()->create();
        $document = Document::factory()->create([
            'user_id' => $user->id, 'original_name' => 'sample.'.$format,
            'path' => 'sample.'.$format, 'mime_type' => $format === 'pdf' ? 'application/pdf' : 'image/png',
        ]);
        $fixture = <<<'PYTHON'
import pymupdf, sys
document = pymupdf.open()
page = document.new_page()
page.insert_text((50, 70), "KhmerDocs OCR sample 2026", fontsize=26)
xs, ys = [40, 170, 450], [100, 140, 190, 240]
for x in xs:
    page.draw_line((x, ys[0]), (x, ys[-1]))
for y in ys:
    page.draw_line((xs[0], y), (xs[-1], y))
for r, values in enumerate([['Time', 'Activity'], ['08:00', 'Registration'], ['09:00', 'Workshop']]):
    for c, value in enumerate(values):
        page.insert_text((xs[c] + 8, ys[r] + 24), value, fontsize=14)
if sys.argv[2] == "png":
    page.get_pixmap(dpi=200).save(sys.argv[1])
else:
    document.save(sys.argv[1])
document.close()
PYTHON;
        Process::run([config('ocr.python'), '-c', $fixture, Storage::disk('local')->path($document->path), $format])->throw();
        Sanctum::actingAs($user);

        $this->postJson('/api/documents/'.$document->id.'/ocr', ['language' => 'eng', 'mode' => $mode])->assertAccepted()
            ->assertJsonPath('data.status', 'queued');

        Artisan::call('queue:work', [
            'connection' => 'ocr', '--queue' => 'ocr', '--once' => true, '--tries' => 1, '--timeout' => 330,
        ]);

        $this->assertDatabaseHas('documents', ['id' => $document->id, 'ocr_status' => 'completed', 'ocr_pages' => 1]);
        $this->assertStringContainsString('KhmerDocs OCR sample 2026', $document->fresh()->ocr_text);
        $this->getJson('/api/documents/'.$document->id.'/ocr/download')->assertOk()
            ->assertStreamedContent($document->fresh()->ocr_text);

        if ($mode === 'structured') {
            $this->getJson('/api/documents/'.$document->id.'/ocr')->assertOk()
                ->assertJsonPath('data.mode', 'structured')
                ->assertJsonPath('data.analysis.summary.tables', 1)
                ->assertJsonPath('data.analysis.schedule.0.time', '08:00')
                ->assertJsonPath('data.analysis.schedule.0.values.1.text', 'Registration')
                ->assertJsonPath('data.analysis.schedule.1.time', '09:00')
                ->assertJsonPath('data.analysis.schedule.1.values.1.text', 'Workshop');
            $this->getJson('/api/documents/'.$document->id.'/ocr/tables/p1-t1/download')->assertOk()
                ->assertDownload('sample-p1-t1.csv')
                ->assertStreamedContent("\xEF\xBB\xBFTime,Activity\n08:00,Registration\n09:00,Workshop\n");
        }
    }

    public function test_analysis_mode_is_queued_and_previous_analysis_is_cleared(): void
    {
        Queue::fake([ProcessDocumentOcr::class]);
        $user = User::factory()->create();
        $document = Document::factory()->create([
            'user_id' => $user->id, 'ocr_status' => 'completed', 'ocr_analysis' => $this->analysisFixture(),
        ]);
        Sanctum::actingAs($user);

        $this->postJson('/api/documents/'.$document->id.'/ocr', ['language' => 'khm+eng', 'mode' => 'structured'])
            ->assertAccepted()->assertJsonPath('data.mode', 'structured')->assertJsonPath('data.analysis', null);

        $this->assertDatabaseHas('documents', ['id' => $document->id, 'ocr_mode' => 'structured', 'ocr_analysis' => null]);
        Queue::assertPushed(ProcessDocumentOcr::class, 1);
    }

    #[TestWith(['summary'])]
    #[TestWith(['structured --unsafe'])]
    #[TestWith([null])]
    #[TestWith([['structured']])]
    public function test_invalid_analysis_mode_is_rejected(mixed $mode): void
    {
        Queue::fake([ProcessDocumentOcr::class]);
        $user = User::factory()->create();
        $document = Document::factory()->create(['user_id' => $user->id]);
        Sanctum::actingAs($user);

        $this->postJson('/api/documents/'.$document->id.'/ocr', ['language' => 'eng', 'mode' => $mode])
            ->assertUnprocessable()->assertJsonValidationErrors('mode');

        $this->assertDatabaseHas('documents', ['id' => $document->id, 'ocr_status' => 'not_started']);
        Queue::assertNothingPushed();
    }

    public function test_analysis_is_private_and_table_csv_preserves_unicode_spans_and_empty_cells(): void
    {
        $user = User::factory()->create();
        $analysis = $this->analysisFixture();
        $document = Document::factory()->create([
            'user_id' => $user->id, 'original_name' => 'schedule.pdf', 'ocr_status' => 'completed',
            'ocr_mode' => 'structured', 'ocr_analysis' => $analysis,
        ]);
        Sanctum::actingAs($user);

        $this->getJson('/api/documents/'.$document->id.'/ocr')->assertOk()
            ->assertJsonPath('data.analysis', $analysis);
        $this->getJson('/api/documents')->assertOk()->assertJsonMissingPath('data.0.ocr_analysis');
        $this->getJson('/api/documents/'.$document->id.'/ocr/tables/p1-t1/download')->assertOk()
            ->assertHeader('Content-Type', 'text/csv; charset=UTF-8')
            ->assertStreamedContent("\xEF\xBB\xBFTime,Activity,Room\n៨:៣០,សកម្មភាព,A\n៨:៣០,'=SUM(A1),\n");
        $this->getJson('/api/documents/'.$document->id.'/ocr/tables/p1-t2/download')->assertNotFound();
    }

    public function test_incomplete_analysis_cannot_export_a_table(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->create(['user_id' => $user->id, 'ocr_status' => 'processing']);
        Sanctum::actingAs($user);

        $this->getJson('/api/documents/'.$document->id.'/ocr/tables/p1-t1/download')->assertConflict();
    }

    private function analysisFixture(): array
    {
        $cell = fn (string $text, int $rowspan = 1): array => ['text' => $text, 'rowspan' => $rowspan, 'colspan' => 1];

        return ['version' => 1, 'pages' => [['number' => 1, 'blocks' => [[
            'type' => 'table', 'id' => 'p1-t1', 'columns' => 3, 'rows' => [
                [$cell('Time'), $cell('Activity'), $cell('Room')],
                [$cell('៨:៣០', 2), $cell('សកម្មភាព'), $cell('A')],
                [null, $cell('=SUM(A1)'), $cell('')],
            ],
        ]]]]];
    }
}
