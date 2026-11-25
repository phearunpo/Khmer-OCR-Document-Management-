<?php

namespace App\Services;

use App\Exceptions\OcrException;
use Illuminate\Process\Exceptions\ProcessTimedOutException;
use Illuminate\Support\Facades\Process;

class DocumentOcrRunner
{
    /** @return array{text: string, pages: int, analysis?: array<string, mixed>} */
    public function extract(string $path, string $language, callable $progress, string $mode = 'text'): array
    {
        $command = [
            config('ocr.python'), config('ocr.script'), $path,
            '--language', $language,
            '--tesseract', config('ocr.tesseract'),
            '--max-pages', (string) config('ocr.max_pages'),
            '--mode', $mode,
        ];

        if (config('ocr.tessdata')) {
            array_push($command, '--tessdata', config('ocr.tessdata'));
        }

        $buffer = '';

        try {
            $process = Process::path(base_path())->timeout(config('ocr.timeout'))
                ->run($command, function (string $type, string $output) use (&$buffer, $progress): void {
                    if ($type !== 'out') {
                        return;
                    }

                    $buffer .= $output;

                    while (($position = strpos($buffer, "\n")) !== false) {
                        $event = json_decode(substr($buffer, 0, $position), true);
                        $buffer = substr($buffer, $position + 1);

                        if (! is_array($event)) {
                            continue;
                        }

                        if (in_array($event['event'] ?? null, ['started', 'page'], true)) {
                            $progress((int) ($event['page'] ?? 0), (int) $event['pages']);
                        }
                    }
                });
        } catch (ProcessTimedOutException $exception) {
            throw new OcrException('Recognition took too long. Split the document into smaller files and try again.', previous: $exception);
        }

        $lines = explode("\n", trim($process->output()));
        $result = json_decode(end($lines), true);

        if (! $process->successful() || ($result['event'] ?? null) !== 'completed' || ! is_string($result['text'] ?? null) || ! is_int($result['pages'] ?? null)) {
            throw new OcrException(($result['event'] ?? null) === 'error'
                ? $result['message']
                : 'Text recognition is unavailable. Please contact your administrator.');
        }

        if ($mode === 'structured') {
            $analysis = $result['analysis'] ?? null;

            if (! is_array($analysis) || ($analysis['version'] ?? null) !== 1
                || ! is_array($analysis['pages'] ?? null) || count($analysis['pages']) !== $result['pages']) {
                throw new OcrException('Document structure could not be read. Please try again.');
            }

            return ['text' => $result['text'], 'pages' => $result['pages'], 'analysis' => $analysis];
        }

        return ['text' => $result['text'], 'pages' => $result['pages']];
    }
}
