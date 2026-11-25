<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->string('ocr_status', 20)->default('not_started');
            $table->uuid('ocr_run_id')->nullable();
            $table->string('ocr_language', 16)->nullable();
            $table->longText('ocr_text')->nullable();
            $table->text('ocr_error')->nullable();
            $table->unsignedInteger('ocr_pages')->nullable();
            $table->unsignedInteger('ocr_processed_pages')->default(0);
            $table->timestamp('ocr_completed_at')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->dropColumn([
                'ocr_status', 'ocr_run_id', 'ocr_language', 'ocr_text', 'ocr_error',
                'ocr_pages', 'ocr_processed_pages', 'ocr_completed_at',
            ]);
        });
    }
};
