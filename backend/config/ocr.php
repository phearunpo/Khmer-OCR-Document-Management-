<?php

$virtualEnvironmentPython = dirname(__DIR__, 2).'/ocr-service/venv/'.(PHP_OS_FAMILY === 'Windows' ? 'Scripts/python.exe' : 'bin/python');

return [
    'python' => env('OCR_PYTHON_BINARY', file_exists($virtualEnvironmentPython) ? $virtualEnvironmentPython : (PHP_OS_FAMILY === 'Windows' ? 'python' : 'python3')),
    'script' => dirname(__DIR__, 2).'/ocr-service/process_document.py',
    'tesseract' => env('OCR_TESSERACT_BINARY', 'tesseract'),
    'tessdata' => env('OCR_TESSDATA_PATH'),
    'max_pages' => 25,
    'timeout' => 300,
];
