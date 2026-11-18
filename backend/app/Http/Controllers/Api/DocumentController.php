<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreDocumentRequest;
use App\Http\Resources\DocumentResource;
use Illuminate\Database\Eloquent\Relations\HasMany;
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
        $filters = $this->documentFilters($request, includePagination: true);
        $sortColumn = ($filters['sort'] ?? 'date') === 'name'
            ? 'original_name'
            : 'created_at';
        $sortDirection = $filters['direction'] ?? 'desc';

        $documents = $this->filteredDocuments($request, $filters)
            ->orderBy($sortColumn, $sortDirection)
            ->orderByDesc('id')
            ->paginate($filters['per_page'] ?? 10)
            ->withQueryString();

        return DocumentResource::collection($documents);
    }

    public function export(Request $request): StreamedResponse
    {
        $filters = $this->documentFilters($request);
        $sortColumn = ($filters['sort'] ?? 'date') === 'name'
            ? 'original_name'
            : 'created_at';
        $sortDirection = $filters['direction'] ?? 'desc';
        $documents = $this->filteredDocuments($request, $filters)
            ->orderBy($sortColumn, $sortDirection)
            ->orderByDesc('id');

        return response()->streamDownload(function () use ($documents): void {
            $output = fopen('php://output', 'wb');
            fputcsv($output, [
                'id',
                'name',
                'type',
                'mime_type',
                'size_bytes',
                'created_at',
                'is_favorite',
                'is_archived',
            ], ',', '"', '');

            foreach ($documents->cursor() as $document) {
                fputcsv($output, [
                    $document->id,
                    $this->protectCsvValue($document->original_name),
                    $document->mime_type === 'application/pdf' ? 'PDF' : 'Image',
                    $document->mime_type,
                    $document->file_size,
                    $document->created_at->toIso8601String(),
                    $document->is_favorite ? 1 : 0,
                    $document->archived_at !== null ? 1 : 0,
                ], ',', '"', '');
            }

            fclose($output);
        }, 'documents.csv', [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    private function documentFilters(Request $request, bool $includePagination = false): array
    {
        $rules = [
            'search' => ['sometimes', 'string', 'max:255'],
            'type' => ['sometimes', 'in:PDF,Image'],
            'sort' => ['sometimes', 'in:name,date'],
            'direction' => ['sometimes', 'in:asc,desc'],
            'favorites' => ['sometimes', 'boolean'],
            'archived' => ['sometimes', 'boolean'],
        ];

        if ($includePagination) {
            $rules['page'] = ['sometimes', 'integer', 'min:1'];
            $rules['per_page'] = ['sometimes', 'integer', 'min:1', 'max:100'];
        }

        return $request->validate($rules);
    }

    private function filteredDocuments(Request $request, array $filters): HasMany
    {
        return $request->user()->documents()
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
            ->when(
                filter_var($filters['favorites'] ?? false, FILTER_VALIDATE_BOOLEAN),
                fn ($query) => $query->where('is_favorite', true),
            )
            ->when(
                filter_var($filters['archived'] ?? false, FILTER_VALIDATE_BOOLEAN),
                fn ($query) => $query->whereNotNull('archived_at'),
                fn ($query) => $query->whereNull('archived_at'),
            );
    }

    private function protectCsvValue(string $value): string
    {
        return preg_match('/^[\t\r\n ]*[=+\-@]/', $value) === 1
            ? "'".$value
            : $value;
    }

    public function show(Request $request, int $document): DocumentResource
    {
        $document = $request->user()->documents()->findOrFail($document);

        return new DocumentResource($document);
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

    public function updateFavorite(Request $request, int $document): DocumentResource
    {
        $validated = $request->validate([
            'is_favorite' => ['required', 'boolean'],
        ]);
        $document = $request->user()->documents()->findOrFail($document);
        $document->update(['is_favorite' => $validated['is_favorite']]);

        return new DocumentResource($document);
    }

    public function updateArchive(Request $request, int $document): DocumentResource
    {
        $validated = $request->validate([
            'archived' => ['required', 'boolean'],
        ]);
        $document = $request->user()->documents()->findOrFail($document);
        $document->update([
            'archived_at' => $validated['archived'] ? now() : null,
        ]);

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

    public function destroyMany(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:100'],
            'ids.*' => ['required', 'integer', 'distinct', 'min:1'],
        ]);
        $documents = $request->user()->documents()
            ->whereKey($validated['ids'])
            ->get();

        if ($documents->count() !== count($validated['ids'])) {
            abort(404);
        }

        foreach ($documents as $document) {
            if (! Storage::disk($document->disk)->delete($document->path)) {
                throw new RuntimeException('Unable to delete the stored document.');
            }
        }

        $request->user()->documents()
            ->whereKey($validated['ids'])
            ->delete();

        return response()->json([
            'data' => [
                'deleted' => $documents->count(),
            ],
        ]);
    }
}
