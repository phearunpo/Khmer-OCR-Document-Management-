<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DocumentResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->original_name,
            'type' => $this->mime_type === 'application/pdf' ? 'PDF' : 'Image',
            'mime_type' => $this->mime_type,
            'size' => $this->file_size,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
