# Current Implementation Issues

**Date**: 2025-01-21 (Updated after comprehensive verification)
**Status**: 2 issues identified and verified through MCP tools and database inspection

## 🚨 Critical Issue

### **Parameter Context Extraction Not Functioning**

**Problem**: The C# parser parameter context extraction feature is not populating database fields.

**Evidence**:
- Database schema exists with `parameter_context`, `call_instance_id`, `parameter_types` fields
- All fields are NULL for all dependencies (verified IDs: 1438007-1438011)
- Expected: Line 242 should store `"playerHandPosition, opponentHandPosition"`
- Actual: NULL

**Impact**: `parameter_analysis` feature in `who_calls` returns undefined

**Action**: Debug C# parser parameter context extraction logic

## ⚠️ Medium Priority Issue

### **MCP Tools Return Verbose Polymorphic Data**

**Problem**: Dependency tools return comprehensive data that appears verbose.

**Example**: CardManager.SetHandPositions with 2 actual method calls returns 7 dependency entries:
- Line 242: 3 entries (interface + self-reference + implementation) for 1 call
- Line 247: 4 entries (2 calls + 2 references) for 1 call

**Analysis**:
- ✅ **AI Beneficial**: Complete polymorphic context improves AI decision-making
- ⚠️ **Human Verbose**: 71% additional context data
- ✅ **Accurate**: All relationships correctly captured

**Action**: Implement result grouping to organize data by logical call sites

### Current Format (flat list):
```json
"dependencies": [
  { "id": 1438007, "dependency_type": "calls", "line_number": 242, "confidence": 0.68, "to_symbol": { "name": "SetHandPositions", "file_path": "...IHandManager.cs" }},
  { "id": 1438008, "dependency_type": "calls", "line_number": 242, "confidence": 0.68, "to_symbol": { "name": "SetHandPositions", "file_path": "...CardManager.cs" }},
  { "id": 1438009, "dependency_type": "calls", "line_number": 242, "confidence": 0.68, "to_symbol": { "name": "SetHandPositions", "file_path": "...HandManager.cs" }},
  { "id": 1438010, "dependency_type": "calls", "line_number": 247, "confidence": 0.8, "to_symbol": { "name": "SetPlayerHandPosition", "file_path": "...ICardPositioningService.cs" }},
  { "id": 1438011, "dependency_type": "calls", "line_number": 247, "confidence": 0.8, "to_symbol": { "name": "SetPlayerHandPosition", "file_path": "...CardPositioningService.cs" }},
  { "id": 1438012, "dependency_type": "references", "line_number": 247, "confidence": 0.56, "to_symbol": { "name": "SetPlayerHandPosition", "file_path": "...ICardPositioningService.cs" }},
  { "id": 1438013, "dependency_type": "references", "line_number": 247, "confidence": 0.56, "to_symbol": { "name": "SetPlayerHandPosition", "file_path": "...CardPositioningService.cs" }}
]
```

### Proposed Grouped Format:
```json
"dependencies": {
  "line_242": {
    "line_number": 242,
    "method_call": "SetHandPositions",
    "variants": [
      { "type": "interface", "target": "IHandManager.SetHandPositions", "confidence": 0.68 },
      { "type": "self_reference", "target": "CardManager.SetHandPositions", "confidence": 0.68 },
      { "type": "implementation", "target": "HandManager.SetHandPositions", "confidence": 0.68 }
    ]
  },
  "line_247": {
    "line_number": 247,
    "method_call": "SetPlayerHandPosition",
    "calls": [
      { "type": "interface", "target": "ICardPositioningService.SetPlayerHandPosition", "confidence": 0.8 },
      { "type": "implementation", "target": "CardPositioningService.SetPlayerHandPosition", "confidence": 0.8 }
    ],
    "references": [
      { "type": "interface", "target": "ICardPositioningService.SetPlayerHandPosition", "confidence": 0.56 },
      { "type": "implementation", "target": "CardPositioningService.SetPlayerHandPosition", "confidence": 0.56 }
    ]
  }
}
```

**Benefits**: Same complete data, better organization for both AI processing and human readability