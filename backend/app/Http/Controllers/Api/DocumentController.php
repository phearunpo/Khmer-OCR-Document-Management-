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
    public function index(Request $request): AnonymousResourceCollection
    {
        return DocumentResource::collection(
            $request->user()->documents()->latest()->get(),
        );
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
