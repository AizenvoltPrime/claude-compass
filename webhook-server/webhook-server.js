#!/usr/bin/env node
"use strict";
/**
 * Claude Compass Webhook Server (rsync version)
 * Syncs changed files from Hetzner to local WSL, then triggers analysis
 * MUCH faster than SSHFS - uses local file I/O
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
var express_1 = require("express");
var child_process_1 = require("child_process");
var util_1 = require("util");
var promises_1 = require("fs/promises");
var execAsync = (0, util_1.promisify)(child_process_1.exec);
// Configuration
var CONFIG = {
    port: 3456,
    webhookSecret: process.env.WEBHOOK_SECRET || 'your-secret-key-here',
    compassPath: process.env.COMPASS_PATH,
    // NEW: Local project path (where rsync copies files)
    localProjectPath: process.env.LOCAL_PROJECT_PATH,
    // NEW: Remote connection details
    remoteHost: process.env.REMOTE_HOST,
    remoteProjectPath: process.env.REMOTE_PROJECT_PATH,
    batchDelayMs: parseInt(process.env.BATCH_DELAY_MS || '3000'),
    logFile: '/tmp/compass-webhook.log',
    // Sync strategy: 'incremental' or 'full'
    syncStrategy: process.env.SYNC_STRATEGY || 'incremental',
    // Analysis configuration
    enableAnalysis: process.env.ENABLE_ANALYSIS !== 'false', // true by default
    analysisFlags: process.env.ANALYSIS_FLAGS || '--verbose', // e.g., '--verbose --skip-embeddings --force-full'
};
// Batch processing queue
var pendingChanges = new Set();
var batchTimer = null;
function log(message) {
    return __awaiter(this, void 0, void 0, function () {
        var timestamp, logMessage;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    timestamp = new Date().toISOString();
                    logMessage = "[".concat(timestamp, "] ").concat(message, "\n");
                    console.log(logMessage.trim());
                    return [4 /*yield*/, promises_1.default.appendFile(CONFIG.logFile, logMessage).catch(function () { })];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function verifyWebhook(req) {
    var secret = req.headers['x-webhook-secret'];
    return secret === CONFIG.webhookSecret;
}
// NEW: Sync files from Hetzner to local WSL using rsync
function syncFiles(changedFiles) {
    return __awaiter(this, void 0, void 0, function () {
        var syncStart, command, stderr, syncTime, error_1, err, tmpFile, command, syncTime, error_2, err;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    syncStart = Date.now();
                    if (!(CONFIG.syncStrategy === 'full' || changedFiles.length === 0)) return [3 /*break*/, 10];
                    // Full project sync - only files Claude Compass analyzes
                    return [4 /*yield*/, log("\uD83D\uDD04 Performing full rsync (excluding dependencies, build artifacts, logs, cache)...")];
                case 1:
                    // Full project sync - only files Claude Compass analyzes
                    _a.sent();
                    command = "rsync -az --delete       --exclude='node_modules'       --exclude='vendor'       --exclude='bin'       --exclude='obj'       --exclude='*.dll'       --exclude='*.exe'       --exclude='*.pdb'       --exclude='storage/logs'       --exclude='storage/framework'       --exclude='storage/app/cache'       --exclude='storage/app/public'       --exclude='storage/app/json'       --exclude='storage/app/private'       --exclude='storage/app/temp'       --exclude='storage/oauth-*.key'       --exclude='storage/*.key'       --exclude='storage/*.json'       --exclude='public/uploads'       --exclude='public/build'       --exclude='public/hot'       --exclude='.git'       --exclude='dist'       --exclude='build'       --exclude='*.log'       --exclude='*.cache'       --exclude='.env'       ".concat(CONFIG.remoteHost, ":").concat(CONFIG.remoteProjectPath, "/ ").concat(CONFIG.localProjectPath, "/");
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 7, , 9]);
                    return [4 /*yield*/, execAsync(command, {
                            timeout: 120000, // 2 minute timeout
                        })];
                case 3:
                    stderr = (_a.sent()).stderr;
                    syncTime = ((Date.now() - syncStart) / 1000).toFixed(2);
                    return [4 /*yield*/, log("\u2705 Full sync completed in ".concat(syncTime, "s"))];
                case 4:
                    _a.sent();
                    if (!(stderr && stderr.trim())) return [3 /*break*/, 6];
                    return [4 /*yield*/, log("Rsync output: ".concat(stderr))];
                case 5:
                    _a.sent();
                    _a.label = 6;
                case 6: return [3 /*break*/, 9];
                case 7:
                    error_1 = _a.sent();
                    err = error_1;
                    return [4 /*yield*/, log("\u274C Full sync failed: ".concat(err.message))];
                case 8:
                    _a.sent();
                    throw error_1;
                case 9: return [3 /*break*/, 20];
                case 10: 
                // Incremental sync (MUCH faster - only changed files)
                return [4 /*yield*/, log("\uD83D\uDD04 Syncing ".concat(changedFiles.length, " changed file(s)..."))];
                case 11:
                    // Incremental sync (MUCH faster - only changed files)
                    _a.sent();
                    tmpFile = "/tmp/rsync-files-".concat(Date.now(), ".txt");
                    return [4 /*yield*/, promises_1.default.writeFile(tmpFile, changedFiles.join('\n'))];
                case 12:
                    _a.sent();
                    command = "rsync -az --files-from=".concat(tmpFile, " ").concat(CONFIG.remoteHost, ":").concat(CONFIG.remoteProjectPath, "/ ").concat(CONFIG.localProjectPath, "/");
                    _a.label = 13;
                case 13:
                    _a.trys.push([13, 17, , 20]);
                    return [4 /*yield*/, execAsync(command, {
                            timeout: 60000, // 1 minute timeout
                        })];
                case 14:
                    _a.sent();
                    syncTime = ((Date.now() - syncStart) / 1000).toFixed(2);
                    return [4 /*yield*/, log("\u2705 Incremental sync completed in ".concat(syncTime, "s"))];
                case 15:
                    _a.sent();
                    // Cleanup temp file
                    return [4 /*yield*/, promises_1.default.unlink(tmpFile).catch(function () { })];
                case 16:
                    // Cleanup temp file
                    _a.sent();
                    return [3 /*break*/, 20];
                case 17:
                    error_2 = _a.sent();
                    err = error_2;
                    return [4 /*yield*/, log("\u26A0\uFE0F Incremental sync failed, falling back to full sync: ".concat(err.message))];
                case 18:
                    _a.sent();
                    // Cleanup temp file
                    return [4 /*yield*/, promises_1.default.unlink(tmpFile).catch(function () { })];
                case 19:
                    // Cleanup temp file
                    _a.sent();
                    // Fallback to full sync if incremental fails
                    return [2 /*return*/, syncFiles([])];
                case 20: return [2 /*return*/];
            }
        });
    });
}
// Trigger analysis on LOCAL copy
function triggerAnalysis(changedFiles) {
    return __awaiter(this, void 0, void 0, function () {
        var command, _a, stdout, stderr, error_3, err;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!!CONFIG.enableAnalysis) return [3 /*break*/, 2];
                    return [4 /*yield*/, log("\u23ED\uFE0F Analysis disabled (ENABLE_ANALYSIS=false)")];
                case 1:
                    _b.sent();
                    return [2 /*return*/];
                case 2: return [4 /*yield*/, log("Triggering analysis on local copy for ".concat(changedFiles.length, " file(s)"))];
                case 3:
                    _b.sent();
                    return [4 /*yield*/, log("Analysis flags: ".concat(CONFIG.analysisFlags))];
                case 4:
                    _b.sent();
                    _b.label = 5;
                case 5:
                    _b.trys.push([5, 13, , 15]);
                    command = "cd ".concat(CONFIG.compassPath, " && npm run analyze ").concat(CONFIG.localProjectPath, " ").concat(CONFIG.analysisFlags);
                    return [4 /*yield*/, log("Executing: ".concat(command))];
                case 6:
                    _b.sent();
                    return [4 /*yield*/, execAsync(command, {
                            timeout: 300000, // 5 minute timeout
                            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
                        })];
                case 7:
                    _a = _b.sent(), stdout = _a.stdout, stderr = _a.stderr;
                    if (!stdout) return [3 /*break*/, 9];
                    return [4 /*yield*/, log("Analysis output: ".concat(stdout.substring(0, 500), "..."))];
                case 8:
                    _b.sent();
                    _b.label = 9;
                case 9:
                    if (!stderr) return [3 /*break*/, 11];
                    return [4 /*yield*/, log("Analysis stderr: ".concat(stderr))];
                case 10:
                    _b.sent();
                    _b.label = 11;
                case 11: return [4 /*yield*/, log("\u2705 Analysis completed successfully")];
                case 12:
                    _b.sent();
                    return [3 /*break*/, 15];
                case 13:
                    error_3 = _b.sent();
                    err = error_3;
                    return [4 /*yield*/, log("\u274C Analysis failed: ".concat(err.message))];
                case 14:
                    _b.sent();
                    throw error_3;
                case 15: return [2 /*return*/];
            }
        });
    });
}
// Process batched changes: sync THEN analyze
function processBatch() {
    return __awaiter(this, void 0, void 0, function () {
        var files, error_4, err;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (pendingChanges.size === 0)
                        return [2 /*return*/];
                    files = Array.from(pendingChanges);
                    pendingChanges.clear();
                    batchTimer = null;
                    return [4 /*yield*/, log("Processing batch of ".concat(files.length, " changed file(s)"))];
                case 1:
                    _a.sent();
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 5, , 7]);
                    // Step 1: Sync files from Hetzner to local
                    return [4 /*yield*/, syncFiles(files)];
                case 3:
                    // Step 1: Sync files from Hetzner to local
                    _a.sent();
                    // Step 2: Analyze local copy (FAST - no network I/O!)
                    return [4 /*yield*/, triggerAnalysis(files)];
                case 4:
                    // Step 2: Analyze local copy (FAST - no network I/O!)
                    _a.sent();
                    return [3 /*break*/, 7];
                case 5:
                    error_4 = _a.sent();
                    err = error_4;
                    return [4 /*yield*/, log("\u274C Batch processing failed: ".concat(err.message))];
                case 6:
                    _a.sent();
                    return [3 /*break*/, 7];
                case 7: return [2 /*return*/];
            }
        });
    });
}
function scheduleBatch() {
    if (batchTimer) {
        clearTimeout(batchTimer);
    }
    batchTimer = setTimeout(processBatch, CONFIG.batchDelayMs);
}
// Express server setup
var app = (0, express_1.default)();
app.use(express_1.default.json());
app.get('/health', function (_req, res) {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        pendingChanges: pendingChanges.size,
        config: {
            port: CONFIG.port,
            compassPath: CONFIG.compassPath,
            localProjectPath: CONFIG.localProjectPath,
            remoteHost: CONFIG.remoteHost,
            syncStrategy: CONFIG.syncStrategy,
            enableAnalysis: CONFIG.enableAnalysis,
            analysisFlags: CONFIG.analysisFlags,
            batchDelayMs: CONFIG.batchDelayMs,
        },
    });
});
app.post('/webhook/file-changed', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var payload;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                if (!!verifyWebhook(req)) return [3 /*break*/, 2];
                return [4 /*yield*/, log('❌ Invalid webhook secret')];
            case 1:
                _a.sent();
                return [2 /*return*/, res.status(401).json({ error: 'Unauthorized' })];
            case 2:
                payload = req.body;
                if (!(!payload.file_path || !payload.event)) return [3 /*break*/, 4];
                return [4 /*yield*/, log('❌ Invalid webhook payload')];
            case 3:
                _a.sent();
                return [2 /*return*/, res.status(400).json({ error: 'Invalid payload' })];
            case 4: return [4 /*yield*/, log("\uD83D\uDCC1 File ".concat(payload.event, ": ").concat(payload.file_path))];
            case 5:
                _a.sent();
                // Add to batch queue
                pendingChanges.add(payload.file_path);
                scheduleBatch();
                res.json({
                    status: 'queued',
                    file: payload.file_path,
                    event: payload.event,
                    batchSize: pendingChanges.size,
                    willProcessIn: "".concat(CONFIG.batchDelayMs / 1000, "s"),
                });
                return [2 /*return*/];
        }
    });
}); });
app.post('/trigger/analyze', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var error_5, err;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                if (!verifyWebhook(req)) {
                    return [2 /*return*/, res.status(401).json({ error: 'Unauthorized' })];
                }
                return [4 /*yield*/, log('🚀 Manual analysis trigger requested')];
            case 1:
                _a.sent();
                _a.label = 2;
            case 2:
                _a.trys.push([2, 5, , 6]);
                return [4 /*yield*/, syncFiles([])];
            case 3:
                _a.sent(); // Full sync
                return [4 /*yield*/, triggerAnalysis([])];
            case 4:
                _a.sent();
                res.json({ status: 'success', message: 'Analysis triggered' });
                return [3 /*break*/, 6];
            case 5:
                error_5 = _a.sent();
                err = error_5;
                res.status(500).json({ status: 'error', message: err.message });
                return [3 /*break*/, 6];
            case 6: return [2 /*return*/];
        }
    });
}); });
// NEW: Manual sync endpoint (no analysis)
app.post('/trigger/sync', function (_req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var error_6, err;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                if (!verifyWebhook(_req)) {
                    return [2 /*return*/, res.status(401).json({ error: 'Unauthorized' })];
                }
                return [4 /*yield*/, log('🔄 Manual sync trigger requested')];
            case 1:
                _a.sent();
                _a.label = 2;
            case 2:
                _a.trys.push([2, 4, , 5]);
                return [4 /*yield*/, syncFiles([])];
            case 3:
                _a.sent(); // Full sync
                res.json({ status: 'success', message: 'Sync completed' });
                return [3 /*break*/, 5];
            case 4:
                error_6 = _a.sent();
                err = error_6;
                res.status(500).json({ status: 'error', message: err.message });
                return [3 /*break*/, 5];
            case 5: return [2 /*return*/];
        }
    });
}); });
app.listen(CONFIG.port, '0.0.0.0', function () {
    log("\uD83D\uDE80 Webhook server running on port ".concat(CONFIG.port, " (rsync mode)"));
    log("\uD83D\uDCC2 Compass path: ".concat(CONFIG.compassPath));
    log("\uD83D\uDCC2 Local project: ".concat(CONFIG.localProjectPath));
    log("\uD83C\uDF10 Remote: ".concat(CONFIG.remoteHost, ":").concat(CONFIG.remoteProjectPath));
    log("\uD83D\uDD12 Secret configured: ".concat(CONFIG.webhookSecret.substring(0, 10), "..."));
    log("\u2699\uFE0F  Sync strategy: ".concat(CONFIG.syncStrategy));
    log("\uD83D\uDD0D Analysis enabled: ".concat(CONFIG.enableAnalysis));
    log("\uD83D\uDEA9 Analysis flags: ".concat(CONFIG.analysisFlags));
    log("\u23F1\uFE0F  Batch delay: ".concat(CONFIG.batchDelayMs, "ms"));
});
process.on('SIGTERM', function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, log('Received SIGTERM, shutting down...')];
            case 1:
                _a.sent();
                if (!(pendingChanges.size > 0)) return [3 /*break*/, 4];
                return [4 /*yield*/, log('Processing pending changes before shutdown...')];
            case 2:
                _a.sent();
                return [4 /*yield*/, processBatch()];
            case 3:
                _a.sent();
                _a.label = 4;
            case 4:
                process.exit(0);
                return [2 /*return*/];
        }
    });
}); });
