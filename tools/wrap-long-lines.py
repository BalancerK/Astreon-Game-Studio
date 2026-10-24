#!/usr/bin/env python3
"""Break over-long lines of JavaScript at the commas of their outermost brackets, the way a person would, so the style check (150 columns) passes.
Only lines made of one statement without a trailing comment are touched; anything it cannot split safely is listed for a person to fix.
Usage: python3 tools/wrap-long-lines.py file.js [more.js ...]"""
import sys

LIMIT = 148


def scan(line):
    """Yield (index, char, depth, in_text) for every character, tracking strings, template literals and comments."""
    depth, quote, i = 0, None, 0
    while i < len(line):
        ch = line[i]
        if quote:
            if ch == '\\':
                i += 2
                continue
            if ch == quote:
                quote = None
            yield i, ch, depth, True
        elif ch in '"\'`':
            quote = ch
            yield i, ch, depth, True
        elif ch == '/' and line[i + 1:i + 2] == '/':
            yield i, 'COMMENT', depth, False
            return
        else:
            if ch in '([{':
                depth += 1
            elif ch in ')]}':
                depth -= 1
            yield i, ch, depth, False
        i += 1


def wrap(line):
    indent = len(line) - len(line.lstrip(' '))
    commas = []
    for i, ch, depth, text in scan(line):
        if ch == 'COMMENT':
            return None                         # a trailing comment: leave it to a person
        if ch == ',' and not text and depth >= 1:
            commas.append((i, depth))
    if not commas:
        return None
    d = min(depth for _, depth in commas)
    cuts = [i + 1 for i, depth in commas if depth == d]
    pieces, last = [], 0
    for c in cuts:
        pieces.append(line[last:c].strip() if last else line[last:c].rstrip())
        last = c
    pieces.append(line[last:].strip())
    out, current = [], pieces[0]
    pad = ' ' * (indent + 2)
    for piece in pieces[1:]:
        if len(current) + 1 + len(piece) <= LIMIT:
            current += ' ' + piece
        else:
            out.append(current)
            current = pad + piece
    out.append(current)
    return out if all(len(l) <= LIMIT + 2 for l in out) else None


def main(paths):
    left = []
    for path in paths:
        lines = open(path, encoding='utf8').read().split('\n')
        result = []
        for n, line in enumerate(lines, 1):
            stripped = line.strip()
            is_comment = stripped.startswith(('//', '*', '/*'))
            if len(line) > 150 and not is_comment:
                wrapped = wrap(line)
                if wrapped:
                    result.extend(wrapped)
                    continue
                left.append(f'{path}:{n} ({len(line)})')
            result.append(line)
        open(path, 'w', encoding='utf8').write('\n'.join(result))
    for item in left:
        print('could not split:', item)


if __name__ == '__main__':
    main(sys.argv[1:])
