<?php

namespace App\Jobs;

use App\Exceptions\OcrException;
use App\Models\Document;
use App\Services\DocumentOcrRunner;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Storage;
use Throwable;

class ProcessDocumentOcr implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 330;

    public bool $failOnTimeout = true;

    public function __construct(public int $documentId, public string $runId)
    {
        $this->onConnection('ocr');
        $this->onQueue('ocr');
    }

    /**
     * Execute the job.
     */
    public function handle(DocumentOcrRunner $runner): void
    {
        $query = Document::query()->whereKey($this->documentId)->where('ocr_run_id', $this->runId);

        if ((clone $query)->where('ocr_status', 'queued')->update(['ocr_status' => 'processing']) === 0) {
            return;
        }

        try {
            $document = $query->first();

            if ($document === null) {
                return;
            }

            $disk = Storage::disk($document->disk);

            if (! $disk->exists($document->path)) {
                throw new OcrException('The original file is no longer available.');
            }

            $result = $runner->extract($disk->path($document->path), $document->ocr_language,
                function (int $processed, int $pages) use ($query): void {
                    (clone $query)->where('ocr_status', 'processing')->update([
                        'ocr_processed_pages' => $processed,
                        'ocr_pages' => $pages,
                    ]);
                }, $document->ocr_mode ?? 'text');

            (clone $query)->where('ocr_status', 'processing')->update([
                'ocr_status' => 'completed',
                'ocr_text' => $result['text'],
                'ocr_analysis' => isset($result['analysis']) ? json_encode($result['analysis'], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE) : null,
                'ocr_pages' => $result['pages'],
                'ocr_processed_pages' => $result['pages'],
                'ocr_completed_at' => now(),
                'ocr_error' => null,
            ]);
        } catch (Throwable $exception) {
            (clone $query)->where('ocr_status', 'processing')->update([
                'ocr_status' => 'failed',
                'ocr_error' => $exception instanceof OcrException
                    ? $exception->getMessage()
                    : 'Recognition could not finish. Please try again.',
            ]);

            throw $exception;
        }
    }

    public function failed(?Throwable $exception): void
    {
        Document::query()->whereKey($this->documentId)->where('ocr_run_id', $this->runId)
            ->whereIn('ocr_status', ['queued', 'processing'])->update([
                'ocr_status' => 'failed',
                'ocr_error' => 'Recognition was interrupted. Please try again.',
            ]);
    }
}
