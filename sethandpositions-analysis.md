# SetHandPositions Analysis - Who Calls Report

## Search Results

Found 3 implementations of `SetHandPositions`:

### 1. Interface Definition (IHandManager.cs)
- **Symbol ID**: 33527
- **Type**: method
- **Line**: 13
- **Signature**: `void SetHandPositions(Node3D playerHandPosition, Node3D opponentHandPosition)`
- **File**: `/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/core/interfaces/cardmanager/IHandManager.cs`
- **Framework**: godot

### 2. CardManager Implementation
- **Symbol ID**: 33665
- **Type**: method
- **Lines**: 233-249
- **Signature**: `public void SetHandPositions(Node3D playerHandPosition, Node3D opponentHandPosition)`
- **File**: `/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/core/managers/CardManager.cs`
- **Framework**: godot

### 3. HandManager Implementation
- **Symbol ID**: 35247
- **Type**: method
- **Lines**: 263-276
- **Signature**: `public void SetHandPositions(Node3D playerHandPosition, Node3D opponentHandPosition)`
- **File**: `/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/core/services/cardmanager/HandManager.cs`
- **Framework**: godot

## Who Calls Analysis

### Interface Definition (Symbol ID: 33527)

```json
{
  "dependencies": [
    {
      "from": "CardManager",
      "to": "SetHandPositions",
      "type": "calls",
      "line_number": 242,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/core/managers/CardManager.cs"
    },
    {
      "from": "CardManager",
      "to": "SetHandPositions",
      "type": "references",
      "line_number": 242,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/core/managers/CardManager.cs"
    },
    {
      "from": "DeckController",
      "to": "SetHandPositions",
      "type": "calls",
      "line_number": 226,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/gameplay/cards/DeckController.cs"
    },
    {
      "from": "DeckController",
      "to": "SetHandPositions",
      "type": "calls",
      "line_number": 242,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/gameplay/cards/DeckController.cs"
    },
    {
      "from": "DeckController",
      "to": "SetHandPositions",
      "type": "references",
      "line_number": 226,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/gameplay/cards/DeckController.cs"
    },
    {
      "from": "DeckController",
      "to": "SetHandPositions",
      "type": "references",
      "line_number": 242,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/gameplay/cards/DeckController.cs"
    }
  ],
  "total_count": 6,
  "parameter_analysis": {
    "method_name": "SetHandPositions",
    "total_calls": 3,
    "total_variations": 3,
    "parameter_variations": [
      {
        "parameters": "playerHandPosition, opponentHandPosition",
        "call_count": 1,
        "usage_locations": [
          {
            "caller": "CardManager",
            "file": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/core/managers/CardManager.cs",
            "line": 242
          }
        ],
        "call_instance_ids": [
          "add446af-74d8-4d69-a58a-153adde69782"
        ]
      },
      {
        "parameters": "_handPosition, null",
        "call_count": 1,
        "usage_locations": [
          {
            "caller": "DeckController",
            "file": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/gameplay/cards/DeckController.cs",
            "line": 226
          }
        ],
        "call_instance_ids": [
          "c97bf2ee-645d-af62-6b32-76fc36995063"
        ]
      },
      {
        "parameters": "playerHandPos, _handPosition",
        "call_count": 1,
        "usage_locations": [
          {
            "caller": "DeckController",
            "file": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/gameplay/cards/DeckController.cs",
            "line": 242
          }
        ],
        "call_instance_ids": [
          "77940ab8-79f3-1e48-a688-8da409ddbdf3"
        ]
      }
    ],
    "insights": [
      "Method called with 3 different parameter patterns",
      "1 pattern(s) use null parameters (33% of all calls)",
      "All parameter patterns used equally (1 calls each)"
    ]
  },
  "query_info": {
    "symbol": "SetHandPositions",
    "analysis_type": "whoCalls",
    "timestamp": "2025-09-26T22:42:54.887Z"
  }
}
```

### CardManager Implementation (Symbol ID: 33665)

```json
{
  "dependencies": [
    {
      "from": "CardManager",
      "to": "SetHandPositions",
      "type": "calls",
      "line_number": 242,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/core/managers/CardManager.cs"
    },
    {
      "from": "CardManager",
      "to": "SetHandPositions",
      "type": "references",
      "line_number": 242,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/core/managers/CardManager.cs"
    },
    {
      "from": "DeckController",
      "to": "SetHandPositions",
      "type": "calls",
      "line_number": 226,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/gameplay/cards/DeckController.cs"
    },
    {
      "from": "DeckController",
      "to": "SetHandPositions",
      "type": "calls",
      "line_number": 242,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/gameplay/cards/DeckController.cs"
    },
    {
      "from": "DeckController",
      "to": "SetHandPositions",
      "type": "references",
      "line_number": 226,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/gameplay/cards/DeckController.cs"
    },
    {
      "from": "DeckController",
      "to": "SetHandPositions",
      "type": "references",
      "line_number": 242,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/gameplay/cards/DeckController.cs"
    },
    {
      "from": "SetHandPositions",
      "to": "SetHandPositions",
      "type": "calls",
      "line_number": 242,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/core/managers/CardManager.cs"
    }
  ],
  "total_count": 7,
  "parameter_analysis": {
    "method_name": "SetHandPositions",
    "total_calls": 4,
    "total_variations": 3,
    "parameter_variations": [
      {
        "parameters": "playerHandPosition, opponentHandPosition",
        "call_count": 2,
        "usage_locations": [
          {
            "caller": "SetHandPositions",
            "file": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/core/managers/CardManager.cs",
            "line": 242
          },
          {
            "caller": "CardManager",
            "file": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/core/managers/CardManager.cs",
            "line": 242
          }
        ],
        "call_instance_ids": [
          "add446af-74d8-4d69-a58a-153adde69782",
          "add446af-74d8-4d69-a58a-153adde69782"
        ]
      },
      {
        "parameters": "_handPosition, null",
        "call_count": 1,
        "usage_locations": [
          {
            "caller": "DeckController",
            "file": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/gameplay/cards/DeckController.cs",
            "line": 226
          }
        ],
        "call_instance_ids": [
          "c97bf2ee-645d-af62-6b32-76fc36995063"
        ]
      },
      {
        "parameters": "playerHandPos, _handPosition",
        "call_count": 1,
        "usage_locations": [
          {
            "caller": "DeckController",
            "file": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/gameplay/cards/DeckController.cs",
            "line": 242
          }
        ],
        "call_instance_ids": [
          "77940ab8-79f3-1e48-a688-8da409ddbdf3"
        ]
      }
    ],
    "insights": [
      "Method called with 3 different parameter patterns",
      "1 pattern(s) use null parameters (25% of all calls)",
      "Most common pattern: \"playerHandPosition, opponentHandPosition\" (2 calls, 50%)"
    ]
  },
  "query_info": {
    "symbol": "SetHandPositions",
    "analysis_type": "whoCalls",
    "timestamp": "2025-09-26T22:40:25.881Z"
  }
}
```

### HandManager Implementation (Symbol ID: 35247)

```json
{
  "dependencies": [
    {
      "from": "SetHandPositions",
      "to": "SetHandPositions",
      "type": "calls",
      "line_number": 242,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/core/managers/CardManager.cs"
    },
    {
      "from": "SetHandPositions",
      "to": "SetHandPositions",
      "type": "references",
      "line_number": 242,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/core/managers/CardManager.cs"
    },
    {
      "from": "CardManager",
      "to": "SetHandPositions",
      "type": "calls",
      "line_number": 242,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/core/managers/CardManager.cs"
    },
    {
      "from": "CardManager",
      "to": "SetHandPositions",
      "type": "references",
      "line_number": 242,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/core/managers/CardManager.cs"
    },
    {
      "from": "DeckController",
      "to": "SetHandPositions",
      "type": "calls",
      "line_number": 226,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/gameplay/cards/DeckController.cs"
    },
    {
      "from": "DeckController",
      "to": "SetHandPositions",
      "type": "calls",
      "line_number": 242,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/gameplay/cards/DeckController.cs"
    },
    {
      "from": "DeckController",
      "to": "SetHandPositions",
      "type": "references",
      "line_number": 226,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/gameplay/cards/DeckController.cs"
    },
    {
      "from": "DeckController",
      "to": "SetHandPositions",
      "type": "references",
      "line_number": 242,
      "file_path": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/gameplay/cards/DeckController.cs"
    }
  ],
  "total_count": 8,
  "parameter_analysis": {
    "method_name": "SetHandPositions",
    "total_calls": 3,
    "total_variations": 3,
    "parameter_variations": [
      {
        "parameters": "playerHandPosition, opponentHandPosition",
        "call_count": 1,
        "usage_locations": [
          {
            "caller": "CardManager",
            "file": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/core/managers/CardManager.cs",
            "line": 242
          }
        ],
        "call_instance_ids": [
          "add446af-74d8-4d69-a58a-153adde69782"
        ]
      },
      {
        "parameters": "_handPosition, null",
        "call_count": 1,
        "usage_locations": [
          {
            "caller": "DeckController",
            "file": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/gameplay/cards/DeckController.cs",
            "line": 226
          }
        ],
        "call_instance_ids": [
          "c97bf2ee-645d-af62-6b32-76fc36995063"
        ]
      },
      {
        "parameters": "playerHandPos, _handPosition",
        "call_count": 1,
        "usage_locations": [
          {
            "caller": "DeckController",
            "file": "/mnt/c/Users/astefanopoulos/Documents/project_card_game/scripts/gameplay/cards/DeckController.cs",
            "line": 242
          }
        ],
        "call_instance_ids": [
          "77940ab8-79f3-1e48-a688-8da409ddbdf3"
        ]
      }
    ],
    "insights": [
      "Method called with 3 different parameter patterns",
      "1 pattern(s) use null parameters (33% of all calls)",
      "All parameter patterns used equally (1 calls each)"
    ]
  },
  "query_info": {
    "symbol": "SetHandPositions",
    "analysis_type": "whoCalls",
    "timestamp": "2025-09-26T22:40:25.953Z"
  }
}
```

## Summary

The `SetHandPositions` method is called by:

1. **CardManager** (line 242) - delegates to HandManager implementation
2. **DeckController** (lines 226 & 242) - calls interface method with different parameter patterns

The method uses 3 different parameter patterns, with one pattern using null parameters in 25-33% of calls.