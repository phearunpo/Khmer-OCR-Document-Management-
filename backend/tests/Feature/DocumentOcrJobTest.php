<?php

namespace Tests\Feature;

use App\Exceptions\OcrException;
use App\Jobs\ProcessDocumentOcr;
use App\Models\Document;
use App\Services\DocumentOcrRunner;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Mockery\MockInterface;
use PHPUnit\Framework\Attributes\TestWith;
use RuntimeException;
use Tests\TestCase;

class DocumentOcrJobTest extends TestCase
{
    use RefreshDatabase;

    #[TestWith(["សួស្តីកម្ពុជា\nEnglish text"])]
    #[TestWith([''])]
    public function test_job_saves_unicode_and_empty_results(string $text): void
    {
        $this->freezeTime();
        Storage::fake('local');
        $document = $this->queuedDocument();
        Storage::disk('local')->put($document->path, 'sample file');
        Process::fake(['*' => Process::result(output: json_encode(['event' => 'completed', 'text' => $text, 'pages' => 2])."\n")]);

        (new ProcessDocumentOcr($document->id, $document->ocr_run_id))->handle(app(DocumentOcrRunner::class));

        $this->assertDatabaseHas('documents', [
            'id' => $document->id, 'ocr_status' => 'completed', 'ocr_text' => $text,
            'ocr_pages' => 2, 'ocr_processed_pages' => 2, 'ocr_completed_at' => now(), 'ocr_error' => null,
        ]);
        Process::assertRan(fn ($process): bool => is_array($process->command)
            && in_array(Storage::disk('local')->path($document->path), $process->command, true)
            && in_array('khm+eng', $process->command, true));
    }

    public function test_job_publishes_page_progress_before_completion(): void
    {
        Storage::fake('local');
        $document = $this->queuedDocument();
        Storage::disk('local')->put($document->path, 'sample file');
        $runner = $this->mock(DocumentOcrRunner::class, function (MockInterface $mock) use ($document): void {
            $mock->shouldReceive('extract')->once()->andReturnUsing(function (string $path, string $language, callable $progress) use ($document): array {
                $progress(1, 3);
                $this->assertDatabaseHas('documents', [
                    'id' => $document->id, 'ocr_status' => 'processing', 'ocr_processed_pages' => 1, 'ocr_pages' => 3,
                ]);

                return ['text' => 'Finished', 'pages' => 3];
            });
        });

        (new ProcessDocumentOcr($document->id, $document->ocr_run_id))->handle($runner);

        $this->assertDatabaseHas('documents', ['id' => $document->id, 'ocr_status' => 'completed', 'ocr_processed_pages' => 3]);
    }

    public function test_job_preserves_actionable_ocr_errors(): void
    {
        Storage::fake('local');
        $document = $this->queuedDocument();
        Storage::disk('local')->put($document->path, 'sample file');
        $message = 'This PDF is password protected. Upload an unlocked copy.';
        Process::fake(['*' => Process::result(output: json_encode(['event' => 'error', 'message' => $message])."\n", exitCode: 1)]);

        try {
            (new ProcessDocumentOcr($document->id, $document->ocr_run_id))->handle(app(DocumentOcrRunner::class));
            $this->fail('Failed OCR must raise an exception for the queue worker.');
        } catch (OcrException $exception) {
            $this->assertSame($message, $exception->getMessage());
        }

        $this->assertDatabaseHas('documents', ['id' => $document->id, 'ocr_status' => 'failed', 'ocr_error' => $message, 'ocr_text' => null]);
        Process::assertRanTimes(fn ($process): bool => in_array(config('ocr.script'), $process->command, true), 1);
    }

    public function test_unexpected_errors_do_not_expose_internal_details(): void
    {
        Storage::fake('local');
        $document = $this->queuedDocument();
        Storage::disk('local')->put($document->path, 'sample file');
        $runner = $this->mock(DocumentOcrRunner::class, function (MockInterface $mock): void {
            $mock->shouldReceive('extract')->once()->andThrow(new RuntimeException('secret path and credentials'));
        });

        try {
            (new ProcessDocumentOcr($document->id, $document->ocr_run_id))->handle($runner);
            $this->fail('Failed OCR must raise an exception.');
        } catch (RuntimeException) {
            $this->assertDatabaseHas('documents', [
                'id' => $document->id, 'ocr_status' => 'failed', 'ocr_error' => 'Recognition could not finish. Please try again.',
            ]);
        }
    }

    public function test_missing_original_file_is_retryable_without_running_ocr(): void
    {
        Storage::fake('local');
        Process::fake();
        $document = $this->queuedDocument();

        try {
            (new ProcessDocumentOcr($document->id, $document->ocr_run_id))->handle(app(DocumentOcrRunner::class));
            $this->fail('Missing files must fail recognition.');
        } catch (OcrException) {
            $this->assertDatabaseHas('documents', [
                'id' => $document->id, 'ocr_status' => 'failed', 'ocr_error' => 'The original file is no longer available.',
            ]);
        }

        Process::assertNothingRan();
    }

    public function test_deleted_documents_are_ignored_by_queued_jobs(): void
    {
        Process::fake();
        $document = $this->queuedDocument();
        $job = new ProcessDocumentOcr($document->id, $document->ocr_run_id);
        $document->delete();

        $job->handle(app(DocumentOcrRunner::class));

        $this->assertModelMissing($document);
        Process::assertNothingRan();
    }

    public function test_old_jobs_cannot_overwrite_a_new_run(): void
    {
        Process::fake();
        $document = $this->queuedDocument();
        $job = new ProcessDocumentOcr($document->id, 'old-run');

        $job->handle(app(DocumentOcrRunner::class));
        $job->failed(new RuntimeException('Old failure'));

        $this->assertDatabaseHas('documents', ['id' => $document->id, 'ocr_status' => 'queued', 'ocr_run_id' => $document->ocr_run_id, 'ocr_error' => null]);
        Process::assertNothingRan();
    }

    public function test_interrupted_job_can_be_retried(): void
    {
        $document = $this->queuedDocument(['ocr_status' => 'processing']);

        (new ProcessDocumentOcr($document->id, $document->ocr_run_id))->failed(new RuntimeException('Timeout'));

        $this->assertDatabaseHas('documents', [
            'id' => $document->id, 'ocr_status' => 'failed', 'ocr_error' => 'Recognition was interrupted. Please try again.',
        ]);
    }

    #[TestWith(['not json'])]
    #[TestWith([''])]
    #[TestWith(['{"event":"completed","text":null,"pages":1}'])]
    public function test_invalid_ocr_output_fails_without_publishing_a_result(string $output): void
    {
        Storage::fake('local');
        $document = $this->queuedDocument();
        Storage::disk('local')->put($document->path, 'sample file');
        Process::fake(['*' => Process::result(output: $output)]);

        try {
            (new ProcessDocumentOcr($document->id, $document->ocr_run_id))->handle(app(DocumentOcrRunner::class));
            $this->fail('Invalid output must not be saved as recognized text.');
        } catch (OcrException) {
            $this->assertDatabaseHas('documents', ['id' => $document->id, 'ocr_status' => 'failed', 'ocr_text' => null]);
        }

        Process::assertRanTimes(fn ($process): bool => in_array(config('ocr.script'), $process->command, true), 1);
    }

    private function queuedDocument(array $attributes = []): Document
    {
        return Document::factory()->create([
            'ocr_status' => 'queued', 'ocr_language' => 'khm+eng', 'ocr_run_id' => 'current-run', ...$attributes,
        ]);
    }

    public function test_structured_results_are_saved_as_json_and_pass_the_requested_mode(): void
    {
        Storage::fake('local');
        $document = $this->queuedDocument(['ocr_mode' => 'structured']);
        Storage::disk('local')->put($document->path, 'sample file');
        $analysis = ['version' => 1, 'pages' => [['number' => 1, 'blocks' => []]], 'reading_text' => 'Time: ៨:៣០; Activity: សកម្មភាព'];
        Process::fake(['*' => Process::result(output: json_encode([
            'event' => 'completed', 'text' => $analysis['reading_text'], 'pages' => 1, 'analysis' => $analysis,
        ])."\n")]);

        (new ProcessDocumentOcr($document->id, $document->ocr_run_id))->handle(app(DocumentOcrRunner::class));

        $this->assertSame($analysis, $document->fresh()->ocr_analysis);
        $this->assertDatabaseHas('documents', ['id' => $document->id, 'ocr_status' => 'completed']);
        Process::assertRan(fn ($process): bool => in_array('--mode', $process->command, true) && in_array('structured', $process->command, true));
    }

    public function test_structured_mode_fails_when_the_engine_returns_only_plain_text(): void
    {
        Storage::fake('local');
        $document = $this->queuedDocument(['ocr_mode' => 'structured']);
        Storage::disk('local')->put($document->path, 'sample file');
        Process::fake(['*' => Process::result(output: '{"event":"completed","text":"Unstructured","pages":1}')]);

        try {
            (new ProcessDocumentOcr($document->id, $document->ocr_run_id))->handle(app(DocumentOcrRunner::class));
            $this->fail('Structured mode must not silently publish plain text.');
        } catch (OcrException $exception) {
            $this->assertSame('Document structure could not be read. Please try again.', $exception->getMessage());
        }

        $this->assertDatabaseHas('documents', ['id' => $document->id, 'ocr_status' => 'failed', 'ocr_analysis' => null]);
        Process::assertRanTimes(fn ($process): bool => in_array('structured', $process->command, true), 1);
    }
}
