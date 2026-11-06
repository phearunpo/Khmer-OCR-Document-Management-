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
Route::post('/logout', [AuthController::class, 'logout'])
    ->middleware('auth:sanctum');

Route::get('/documents/{document}/download', [DocumentController::class, 'download'])
    ->middleware('auth:sanctum')
    ->name('documents.download');

Route::apiResource('documents', DocumentController::class)
    ->only(['index', 'store', 'destroy'])
    ->middleware('auth:sanctum');
