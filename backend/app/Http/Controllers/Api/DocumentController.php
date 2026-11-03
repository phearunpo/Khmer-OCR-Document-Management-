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
}
