<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\DocumentController;
use App\Http\Controllers\Api\DocumentOcrController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');
Route::put('/user', [AuthController::class, 'updateProfile'])
    ->middleware('auth:sanctum');
Route::put('/user/password', [AuthController::class, 'updatePassword'])
    ->middleware('auth:sanctum');

Route::post('/login', [AuthController::class, 'login'])
    ->middleware('throttle:6,1');
Route::post('/register', [AuthController::class, 'register'])
    ->middleware('throttle:6,1');
Route::post('/logout', [AuthController::class, 'logout'])
    ->middleware('auth:sanctum');
Route::post('/logout/others', [AuthController::class, 'logoutOtherTokens'])
    ->middleware('auth:sanctum');

Route::get('/documents/{document}/download', [DocumentController::class, 'download'])
    ->middleware('auth:sanctum')
    ->name('documents.download');
Route::get('/documents/{document}/preview', [DocumentController::class, 'preview'])
    ->middleware('auth:sanctum')
    ->name('documents.preview');
Route::get('/documents/summary', [DocumentController::class, 'summary'])
    ->middleware('auth:sanctum')
    ->name('documents.summary');
Route::patch('/documents/{document}/favorite', [DocumentController::class, 'updateFavorite'])
    ->middleware('auth:sanctum')
    ->name('documents.favorite');
Route::patch('/documents/{document}/archive', [DocumentController::class, 'updateArchive'])
    ->middleware('auth:sanctum')
    ->name('documents.archive');
Route::delete('/documents/bulk', [DocumentController::class, 'destroyMany'])
    ->middleware('auth:sanctum')
    ->name('documents.bulk-destroy');
Route::get('/documents/export', [DocumentController::class, 'export'])
    ->middleware('auth:sanctum')
    ->name('documents.export');
Route::get('/documents/{document}/notes', [DocumentController::class, 'showNotes'])
    ->middleware('auth:sanctum')
    ->name('documents.notes.show');
Route::patch('/documents/{document}/notes', [DocumentController::class, 'updateNotes'])
    ->middleware('auth:sanctum')
    ->name('documents.notes.update');

Route::middleware('auth:sanctum')->group(function (): void {
    Route::get('/documents/{document}/ocr', [DocumentOcrController::class, 'show'])
        ->name('documents.ocr.show');
    Route::post('/documents/{document}/ocr', [DocumentOcrController::class, 'store'])
        ->middleware('throttle:12,1')->name('documents.ocr.store');
    Route::get('/documents/{document}/ocr/download', [DocumentOcrController::class, 'download'])
        ->name('documents.ocr.download');
    Route::get('/documents/{document}/ocr/tables/{table}/download', [DocumentOcrController::class, 'downloadTable'])
        ->where('table', 'p[0-9]+-t[0-9]+')->name('documents.ocr.tables.download');
});

Route::apiResource('documents', DocumentController::class)
    ->only(['index', 'show', 'store', 'update', 'destroy'])
    ->middleware('auth:sanctum');
