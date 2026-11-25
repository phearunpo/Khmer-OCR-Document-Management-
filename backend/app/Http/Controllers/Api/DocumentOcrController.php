<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StartDocumentOcrRequest;
use App\Http\Resources\DocumentOcrResource;
use App\Jobs\ProcessDocumentOcr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

class DocumentOcrController extends Controller
{
    public function show(Request $request, int $document): DocumentOcrResource
    {
        return new DocumentOcrResource($request->user()->documents()->findOrFail($document));
    }

    public function store(StartDocumentOcrRequest $request, int $document): JsonResponse
    {
        $document = $request->user()->documents()->findOrFail($document);
        $runId = (string) Str::uuid();
        $updated = $request->user()->documents()->whereKey($document->id)
            ->whereNotIn('ocr_status', ['queued', 'processing'])
            ->update([
                'ocr_status' => 'queued',
                'ocr_run_id' => $runId,
                'ocr_language' => $request->validated('language'),
                'ocr_mode' => $request->validated('mode', 'text'),
                'ocr_analysis' => null,
                'ocr_text' => null,
                'ocr_error' => null,
                'ocr_pages' => null,
                'ocr_processed_pages' => 0,
                'ocr_completed_at' => null,
            ]);

        if ($updated === 0) {
            return response()->json(['message' => 'Text recognition is already in progress.'], 409);
        }

        try {
            Bus::dispatch(new ProcessDocumentOcr($document->id, $runId));
        } catch (Throwable $exception) {
            $request->user()->documents()->whereKey($document->id)->where('ocr_run_id', $runId)
                ->update([
                    'ocr_status' => 'failed',
                    'ocr_error' => 'Recognition could not be started. Please try again.',
                ]);
            report($exception);

            return response()->json(['message' => 'Recognition could not be started. Please try again.'], 503);
        }

        return (new DocumentOcrResource($document->refresh()))->response()->setStatusCode(202);
    }

    public function download(Request $request, int $document): StreamedResponse
    {
        $document = $request->user()->documents()->findOrFail($document);
        abort_unless($document->ocr_status === 'completed', 409, 'Extract text before downloading it.');

        return response()->streamDownload(function () use ($document): void {
            echo $document->ocr_text;
        }, pathinfo($document->original_name, PATHINFO_FILENAME).'-ocr.txt', [
            'Content-Type' => 'text/plain; charset=UTF-8',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function downloadTable(Request $request, int $document, string $table): StreamedResponse
    {
        $document = $request->user()->documents()->findOrFail($document);
        abort_unless($document->ocr_status === 'completed', 409, 'Analyze the document before downloading tables.');
        $selected = null;

        foreach ($document->ocr_analysis['pages'] ?? [] as $page) {
            foreach ($page['blocks'] as $block) {
                if (($block['type'] ?? null) === 'table' && ($block['id'] ?? null) === $table) {
                    $selected = $block;
                    break 2;
                }
            }
        }

        abort_if($selected === null, 404, 'Table not found.');

        return response()->streamDownload(function () use ($selected): void {
            $rows = array_fill(0, count($selected['rows']), array_fill(0, $selected['columns'], ''));

            foreach ($selected['rows'] as $rowIndex => $row) {
                foreach ($row as $columnIndex => $cell) {
                    if ($cell === null) {
                        continue;
                    }

                    for ($r = $rowIndex; $r < min(count($rows), $rowIndex + $cell['rowspan']); $r++) {
                        for ($c = $columnIndex; $c < min($selected['columns'], $columnIndex + $cell['colspan']); $c++) {
                            $value = $cell['text'];
                            $rows[$r][$c] = preg_match('/^[\t\r\n ]*[=+\-@]/', $value) === 1 ? "'".$value : $value;
                        }
                    }
                }
            }

            $output = fopen('php://output', 'wb');
            fwrite($output, "\xEF\xBB\xBF");

            foreach ($rows as $row) {
                fputcsv($output, $row, ',', '"', '');
            }

            fclose($output);
        }, pathinfo($document->original_name, PATHINFO_FILENAME).'-'.$table.'.csv', [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
