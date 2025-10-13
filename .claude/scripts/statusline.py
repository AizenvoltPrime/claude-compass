#!/usr/bin/env python3
"""
Custom Claude Code Statusline
Shows token usage and conversation log file path
"""

import json
import sys
from pathlib import Path
from typing import Optional


def get_context_tokens(transcript_path: str) -> tuple[Optional[int], Optional[int], Optional[int], Optional[int]]:
    """
    Calculate context tokens from transcript file.

    Returns:
        Tuple of (total_context, input_tokens, cache_creation, cache_read)
    """
    try:
        transcript_file = Path(transcript_path)
        if not transcript_file.exists():
            return None, None, None, None

        with open(transcript_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue

            try:
                data = json.loads(line)

                if data.get('type') == 'assistant':
                    message = data.get('message', {})
                    if isinstance(message, dict):
                        usage = message.get('usage', {})
                        if isinstance(usage, dict):
                            input_tokens = usage.get('input_tokens', 0)
                            cache_creation = usage.get('cache_creation_input_tokens', 0)
                            cache_read = usage.get('cache_read_input_tokens', 0)

                            total_context = input_tokens + cache_creation + cache_read

                            if total_context > 0:
                                return total_context, input_tokens, cache_creation, cache_read

            except (json.JSONDecodeError, ValueError):
                continue

        return None, None, None, None

    except Exception:
        return None, None, None, None


def format_tokens(tokens: int) -> str:
    """Format token count with thousands separator."""
    return f"{tokens:,}"


def get_percentage(current: int, limit: int) -> int:
    """Calculate percentage of limit used."""
    return int((current / limit) * 100)


def main():
    """Main statusline script."""
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        print("⚠️  No input data")
        return

    transcript_path = input_data.get("transcript_path", "")
    if not transcript_path:
        print("⚠️  No transcript path")
        return

    # Get token usage
    total_context, input_tokens, cache_creation, cache_read = get_context_tokens(transcript_path)

    if total_context is None:
        print("⚠️  No usage data found")
        return

    # Token limit (matches guardian hook)
    TOKEN_LIMIT = 165000

    # Calculate percentage
    percentage = get_percentage(total_context, TOKEN_LIMIT)

    # Format output
    formatted_total = format_tokens(total_context)
    formatted_limit = format_tokens(TOKEN_LIMIT)

    # Status indicator
    if percentage >= 95:
        status = "🔴"
    elif percentage >= 80:
        status = "🟡"
    else:
        status = "🟢"

    # Build statusline
    statusline_parts = [
        f"{status} {formatted_total}/{formatted_limit} ({percentage}%)",
        f"🆕 New: {format_tokens(input_tokens)}",
        f"🔨 Cache+: {format_tokens(cache_creation)}",
        f"💾 Cached: {format_tokens(cache_read)}",
        f"📝 Log: {transcript_path}"
    ]

    print(" | ".join(statusline_parts))


if __name__ == "__main__":
    main()
