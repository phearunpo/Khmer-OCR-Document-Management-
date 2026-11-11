<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\DocumentController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

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
Route::get('/documents/summary', [DocumentController::class, 'summary'])
    ->middleware('auth:sanctum')
    ->name('documents.summary');

Route::apiResource('documents', DocumentController::class)
    ->only(['index', 'store', 'update', 'destroy'])
    ->middleware('auth:sanctum');
