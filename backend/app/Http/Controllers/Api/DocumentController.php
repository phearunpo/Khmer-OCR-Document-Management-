<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreDocumentRequest;
use App\Http\Resources\DocumentResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

class DocumentController extends Controller
{
    public function summary(Request $request): JsonResponse
    {
        $counts = $request->user()->documents()
            ->selectRaw('mime_type, COUNT(*) AS aggregate')
            ->groupBy('mime_type')
            ->pluck('aggregate', 'mime_type');
        $pdfCount = (int) ($counts['application/pdf'] ?? 0);
        $imageCount = (int) ($counts['image/png'] ?? 0)
            + (int) ($counts['image/jpeg'] ?? 0);

        return response()->json([
            'data' => [
                'total' => $counts->sum(),
                'pdf' => $pdfCount,
                'image' => $imageCount,
            ],
        ]);
    }

    public function index(Request $request): AnonymousResourceCollection
    {
        $filters = $request->validate([
            'search' => ['sometimes', 'string', 'max:255'],
            'type' => ['sometimes', 'in:PDF,Image'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'sort' => ['sometimes', 'in:name,date'],
            'direction' => ['sometimes', 'in:asc,desc'],
        ]);
        $sortColumn = ($filters['sort'] ?? 'date') === 'name'
            ? 'original_name'
            : 'created_at';
        $sortDirection = $filters['direction'] ?? 'desc';

        $documents = $request->user()->documents()
            ->when(
                $filters['search'] ?? null,
                fn ($query, $search) => $query->whereLike('original_name', "%{$search}%"),
            )
            ->when(
                $filters['type'] ?? null,
                fn ($query, $type) => $type === 'PDF'
                    ? $query->where('mime_type', 'application/pdf')
                    : $query->whereIn('mime_type', ['image/png', 'image/jpeg']),
            )
            ->orderBy($sortColumn, $sortDirection)
            ->orderByDesc('id')
            ->paginate($filters['per_page'] ?? 10)
            ->withQueryString();

        return DocumentResource::collection($documents);
    }

    public function store(StoreDocumentRequest $request): JsonResponse
    {
        $file = $request->file('file');
        $user = $request->user();
        $path = $file->store('documents/'.$user->getKey(), 'local');

        if ($path === false) {
            throw new RuntimeException('Unable to store the uploaded document.');
        }

        try {
            $document = $user->documents()->create([
                'original_name' => $file->getClientOriginalName(),
                'disk' => 'local',
                'path' => $path,
                'mime_type' => $file->getMimeType(),
                'file_size' => $file->getSize(),
            ]);
        } catch (Throwable $exception) {
            Storage::disk('local')->delete($path);

            throw $exception;
        }

        return (new DocumentResource($document))
            ->response()
            ->setStatusCode(201);
    }

    public function update(Request $request, int $document): DocumentResource
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255', 'not_regex:/[\/\\\\]/'],
        ]);
        $document = $request->user()->documents()->findOrFail($document);
        $document->update(['original_name' => $validated['name']]);

        return new DocumentResource($document);
    }

    public function download(Request $request, int $document): StreamedResponse
    {
        $document = $request->user()->documents()->findOrFail($document);

        return Storage::disk($document->disk)->download(
            $document->path,
            $document->original_name,
            [
                'Content-Type' => $document->mime_type,
                'X-Content-Type-Options' => 'nosniff',
            ],
        );
    }

    public function preview(Request $request, int $document): StreamedResponse
    {
        $document = $request->user()->documents()->findOrFail($document);

        return Storage::disk($document->disk)->response(
            $document->path,
            $document->original_name,
            [
                'Content-Type' => $document->mime_type,
                'X-Content-Type-Options' => 'nosniff',
            ],
            'inline',
        );
    }

    public function destroy(Request $request, int $document): JsonResponse
    {
        $document = $request->user()->documents()->findOrFail($document);

        if (! Storage::disk($document->disk)->delete($document->path)) {
            throw new RuntimeException('Unable to delete the stored document.');
        }

        $document->delete();

        return response()->json(null, 204);
    }
}
