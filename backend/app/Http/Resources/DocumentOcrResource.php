<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DocumentOcrResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'status' => $this->ocr_status,
            'language' => $this->ocr_language,
            'mode' => $this->ocr_mode ?? 'text',
            'analysis' => $this->ocr_status === 'completed' ? $this->ocr_analysis : null,
            'text' => $this->ocr_status === 'completed' ? $this->ocr_text : null,
            'error' => $this->ocr_error,
            'pages' => $this->ocr_pages,
            'processed_pages' => $this->ocr_processed_pages,
            'completed_at' => $this->ocr_completed_at?->toIso8601String(),
        ];
    }
}
