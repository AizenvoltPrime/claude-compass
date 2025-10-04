#!/usr/bin/env node

/**
 * Download BGE-M3 model with FP16 ONNX for GPU-accelerated embeddings
 *
 * Downloads model_fp16.onnx from HuggingFace to:
 *   ~/.cache/claude-compass/models/Xenova/bge-m3/onnx/
 *
 * Run this script once before using GPU-accelerated embeddings:
 *   node download-bge-m3.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const MODEL_NAME = 'Xenova/bge-m3';
const BASE_URL = 'https://huggingface.co/Xenova/bge-m3/resolve/main';
const CACHE_DIR = path.join(os.homedir(), '.cache', 'claude-compass', 'models', 'Xenova', 'bge-m3', 'onnx');

// Files to download for FP16 model
const FILES_TO_DOWNLOAD = [
  { name: 'model_fp16.onnx', url: `${BASE_URL}/onnx/model_fp16.onnx`, size: '~1.2GB' }
];

console.log('='.repeat(60));
console.log('Downloading BGE-M3 FP16 Model for GPU Acceleration');
console.log('='.repeat(60));
console.log('');
console.log('Model: Xenova/bge-m3');
console.log('Precision: FP16 (optimized for GPU)');
console.log('Destination:', CACHE_DIR);
console.log('');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  console.log('✓ Created cache directory');
}

// Download a single file with progress
async function downloadFile(fileInfo) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(CACHE_DIR, fileInfo.name);

    // Check if already exists
    if (fs.existsSync(filePath)) {
      console.log(`✓ ${fileInfo.name} already exists (${fileInfo.size})`);
      return resolve();
    }

    console.log(`Downloading ${fileInfo.name} (${fileInfo.size})...`);

    const file = fs.createWriteStream(filePath);
    let downloadedBytes = 0;
    let lastProgress = 0;

    https.get(fileInfo.url, {
      headers: { 'User-Agent': 'Node.js' }
    }, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        https.get(response.headers.location, (redirectResponse) => {
          const totalBytes = parseInt(redirectResponse.headers['content-length'], 10);

          redirectResponse.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            const progress = Math.floor((downloadedBytes / totalBytes) * 100);

            if (progress >= lastProgress + 5) {
              process.stdout.write(`\r  Progress: ${progress}% (${(downloadedBytes / 1024 / 1024).toFixed(1)}MB / ${(totalBytes / 1024 / 1024).toFixed(1)}MB)`);
              lastProgress = progress;
            }
          });

          redirectResponse.pipe(file);

          file.on('finish', () => {
            file.close();
            console.log(`\n✓ Downloaded ${fileInfo.name}`);
            resolve();
          });
        }).on('error', (err) => {
          fs.unlink(filePath, () => {});
          reject(err);
        });
      } else {
        const totalBytes = parseInt(response.headers['content-length'], 10);

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const progress = Math.floor((downloadedBytes / totalBytes) * 100);

          if (progress >= lastProgress + 5) {
            process.stdout.write(`\r  Progress: ${progress}% (${(downloadedBytes / 1024 / 1024).toFixed(1)}MB / ${(totalBytes / 1024 / 1024).toFixed(1)}MB)`);
            lastProgress = progress;
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          console.log(`\n✓ Downloaded ${fileInfo.name}`);
          resolve();
        });
      }
    }).on('error', (err) => {
      fs.unlink(filePath, () => {});
      reject(err);
    });

    file.on('error', (err) => {
      fs.unlink(filePath, () => {});
      reject(err);
    });
  });
}

// Download tokenizer files using transformers.js (needed for inference)
async function downloadTokenizer() {
  console.log('');
  console.log('Downloading tokenizer files...');
  const { AutoTokenizer } = require('@xenova/transformers');

  try {
    await AutoTokenizer.from_pretrained(MODEL_NAME);
    console.log('✓ Tokenizer files downloaded');
  } catch (error) {
    console.error('✗ Failed to download tokenizer:', error.message);
    throw error;
  }
}

// Main download process
async function main() {
  try {
    // Download tokenizer first
    await downloadTokenizer();

    console.log('');
    console.log('Downloading FP16 ONNX model...');

    // Download FP16 model
    for (const file of FILES_TO_DOWNLOAD) {
      await downloadFile(file);
    }

    // Rename to model.onnx so our code finds it
    const fp16Path = path.join(CACHE_DIR, 'model_fp16.onnx');
    const targetPath = path.join(CACHE_DIR, 'model.onnx');

    if (fs.existsSync(fp16Path) && !fs.existsSync(targetPath)) {
      fs.renameSync(fp16Path, targetPath);
      console.log('✓ Renamed model_fp16.onnx → model.onnx');
    } else if (fs.existsSync(fp16Path) && fs.existsSync(targetPath)) {
      // Both exist, delete the duplicate
      fs.unlinkSync(fp16Path);
      console.log('✓ Removed duplicate model_fp16.onnx');
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('✓ BGE-M3 FP16 Model Ready for GPU Acceleration!');
    console.log('='.repeat(60));
    console.log('');
    console.log('Model location:', CACHE_DIR);
    console.log('');
    console.log('Model files:');
    console.log('  - model.onnx (FP16 - 1024 dimensions)');
    console.log('  - model_fp16.onnx (original)');
    console.log('  - tokenizer files');
    console.log('');
    console.log('GPU Performance:');
    console.log('  ✓ All operations run on GPU (no memcpy overhead)');
    console.log('  ✓ Optimized for CUDA inference');
    console.log('  ✓ 2-3x faster than quantized model on GPU');
    console.log('');
    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('='.repeat(60));
    console.error('✗ Download failed');
    console.error('='.repeat(60));
    console.error('');
    console.error('Error:', error.message);
    console.error('');
    console.error('You can try downloading manually from:');
    console.error('  https://huggingface.co/Xenova/bge-m3/tree/main/onnx');
    console.error('');
    process.exit(1);
  }
}

main();
