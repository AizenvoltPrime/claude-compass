#!/usr/bin/env python3
"""
Claude Code Hook: Token Limit Guardian
Monitors context window size and stops conversation when exceeding the limit.

This hook mimics ccusage statusline's context token calculation by reading
the most recent message's input_tokens from the transcript file.
"""

import json
import sys
from pathlib import Path
from typing import Optional, Tuple


def get_context_tokens(transcript_path: str) -> Optional[int]:
    """
    Calculate context tokens from transcript file.

    Mimics ccusage's calculateContextTokens logic:
    - Reads transcript file (JSONL)
    - Finds the most recent message with usage data
    - Returns input_tokens (context window size)

    Args:
        transcript_path: Path to the transcript JSONL file

    Returns:
        Context tokens (input_tokens) or None if not found
    """
    try:
        transcript_file = Path(transcript_path)
        if not transcript_file.exists():
            return None

        with open(transcript_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        # Iterate from last line backwards (most recent first)
        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue

            try:
                data = json.loads(line)

                # Check for usage data in message (must be type 'assistant')
                if data.get('type') == 'assistant':
                    message = data.get('message', {})
                    if isinstance(message, dict):
                        usage = message.get('usage', {})
                        if isinstance(usage, dict):
                            input_tokens = usage.get('input_tokens', 0)
                            cache_creation = usage.get('cache_creation_input_tokens', 0)
                            cache_read = usage.get('cache_read_input_tokens', 0)

                            # Calculate total context (matches ccusage logic)
                            total_context = input_tokens + cache_creation + cache_read

                            if total_context > 0:
                                return total_context

            except (json.JSONDecodeError, ValueError):
                continue

        return None

    except Exception:
        return None


def format_tokens(tokens: int) -> str:
    """Format token count with thousands separator."""
    return f"{tokens:,}"


def main():
    """Main hook execution logic."""
    try:
        # Read JSON input from stdin
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        # Not a JSON input, exit silently
        sys.exit(0)

    # Extract transcript path from hook input
    transcript_path = input_data.get("transcript_path", "")
    if not transcript_path:
        # No transcript path provided, allow operation
        sys.exit(0)

    # Get context tokens from transcript
    context_tokens = get_context_tokens(transcript_path)

    if context_tokens is None:
        # No context data found, allow operation
        sys.exit(0)

    # Token limit threshold (context window size)
    # Adjust based on Claude model limits:
    # - Claude Sonnet 4: ~200k context window
    # - Conservative limit: 100k tokens
    # - Stricter limit: 50k tokens
    TOKEN_LIMIT = 165000

    if context_tokens >= TOKEN_LIMIT:
        # Exceeded context limit - block the operation
        formatted_tokens = format_tokens(context_tokens)
        formatted_limit = format_tokens(TOKEN_LIMIT)

        # Use JSON output to block with continue: false
        output = {
            "decision": "block",
            "reason": (
                f"🛑 Context Limit Exceeded\n\n"
                f"❌ Current context: {formatted_tokens} tokens\n"
                f"⚠️  Limit: {formatted_limit} tokens\n\n"
                f"💡 The conversation context has grown too large. "
                f"Please start a new conversation to continue.\n"
                f"📝 Tip: Use /compact or start a fresh session."
            ),
            "continue": False,
            "stopReason": f"Context limit exceeded ({formatted_tokens}/{formatted_limit} tokens)"
        }

        print(json.dumps(output))
        sys.exit(0)

    # Within limits - allow the operation
    sys.exit(0)


if __name__ == "__main__":
    main()
