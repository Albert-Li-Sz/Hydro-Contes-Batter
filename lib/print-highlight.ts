/**
 * A small tokenizer for printing contest code: comments, strings, numbers, keywords and
 * preprocessor lines of the usual contest languages. Pure; the print server renders with it.
 */

const words = (text: string) => new Set(text.split(/\s+/).filter(Boolean));
const cKeywords = 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Bool bool true false NULL';
const keywords: Record<string, Set<string>> = {
    c: words(cKeywords),
    cpp: words(`${cKeywords} alignas alignof and asm catch class constexpr consteval constinit decltype delete explicit export friend mutable namespace new noexcept not nullptr operator or override final private protected public static_assert static_cast dynamic_cast reinterpret_cast const_cast template this thread_local throw try typeid typename using virtual wchar_t xor concept requires co_await co_return co_yield`),
    java: words('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try var void volatile while record yield true false null'),
    kotlin: words('as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while by catch constructor data enum finally get import init internal lateinit open operator out override private protected public sealed set suspend vararg companion inline'),
    python: words('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case print range len int str list dict set tuple self'),
    go: words('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil iota int int64 int32 string bool byte rune float64 error make len cap append new'),
    rust: words('as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while i32 i64 u32 u64 usize isize f64 bool char str String Vec Option Some None Ok Err'),
    javascript: words('async await break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield'),
    csharp: words('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while'),
    pascal: words('and array begin case const div do downto else end file for function goto if in label mod nil not of or packed procedure program record repeat set then to type until var while with integer longint int64 real boolean char string true false writeln readln write read'),
};

interface Syntax { line: string[]; block: [string, string][]; quotes: string[]; triple?: string[]; preprocessor?: boolean; char?: boolean; caseless?: boolean }
const syntax: Record<string, Syntax> = {
    c: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], preprocessor: true },
    cpp: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], preprocessor: true },
    java: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], triple: ['"""'] },
    kotlin: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], triple: ['"""'] },
    csharp: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], preprocessor: true },
    javascript: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'", '`'] },
    go: { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'", '`'] },
    rust: { line: ['//'], block: [['/*', '*/']], quotes: ['"'], char: true },
    python: { line: ['#'], block: [], quotes: ['"', "'"], triple: ['"""', "'''"] },
    pascal: { line: ['//'], block: [['{', '}'], ['(*', '*)']], quotes: ["'"], caseless: true },
};

/**
 * Splits code into lines of tokens `{ type, text }`; type is '' (plain), 'keyword', 'comment',
 * 'string', 'number' or 'preprocessor'. Tokens never span lines.
 */
export type TokenType = '' | 'keyword' | 'comment' | 'string' | 'number' | 'preprocessor';
export interface Token { type: TokenType; text: string }

export function tokenize(code: string, language = 'plain'): Token[][] {
    const rules = syntax[language];
    const tokens: Token[] = [];
    const push = (type: TokenType, text: string) => { if (text) tokens.push({ type, text }); };
    if (!rules) push('', code);
    else {
        const known = keywords[language];
        let index = 0;
        let lineStart = true;
        const at = (text: string) => code.startsWith(text, index);
        while (index < code.length) {
            const char = code[index];
            if (char === '\n') { push('', '\n'); index++; lineStart = true; continue; }
            if (lineStart && rules.preprocessor && /^[ \t]*#/.test(code.slice(index, index + 64))) {
                let end = index;
                // Preprocessor lines continue after a trailing backslash.
                while (end < code.length && (code[end] !== '\n' || code[end - 1] === '\\')) end++;
                push('preprocessor', code.slice(index, end));
                index = end;
                continue;
            }
            lineStart = false;
            const line = rules.line.find(at);
            if (line) {
                const end = code.indexOf('\n', index);
                push('comment', code.slice(index, end < 0 ? code.length : end));
                index = end < 0 ? code.length : end;
                continue;
            }
            const block = rules.block.find(([open]) => at(open));
            if (block) {
                const end = code.indexOf(block[1], index + block[0].length);
                const stop = end < 0 ? code.length : end + block[1].length;
                push('comment', code.slice(index, stop));
                index = stop;
                continue;
            }
            const triple = rules.triple?.find(at);
            if (triple) {
                const end = code.indexOf(triple, index + 3);
                const stop = end < 0 ? code.length : end + 3;
                push('string', code.slice(index, stop));
                index = stop;
                continue;
            }
            // Rust: 'a' is a character, 'a a lifetime.
            if (rules.char && char === "'") {
                const match = /^'(?:\\.|[^\\'\n]){1,8}'/.exec(code.slice(index, index + 12));
                if (match) { push('string', match[0]); index += match[0].length; continue; }
            }
            if (rules.quotes.includes(char)) {
                let end = index + 1;
                while (end < code.length && code[end] !== char) {
                    if (code[end] === '\\' && char !== '`' && !rules.caseless) end++;
                    // Only raw/template strings cross lines; an unclosed quote stops at the line end.
                    else if (code[end] === '\n' && char !== '`') break;
                    end++;
                }
                const stop = code[end] === char ? end + 1 : end;
                push('string', code.slice(index, stop));
                index = stop;
                continue;
            }
            const number = /^(?:0[xX][\da-fA-F_']+|0[bB][01_']+|\d[\d_']*(?:\.\d[\d_']*)?(?:[eE][+-]?\d+)?)[uUlLfF]*/.exec(code.slice(index, index + 64));
            if (number && !/[\w$]/.test(code[index - 1] || '')) { push('number', number[0]); index += number[0].length; continue; }
            const word = /^[A-Za-z_$][\w$]*/.exec(code.slice(index, index + 128));
            if (word) {
                push(known.has(rules.caseless ? word[0].toLowerCase() : word[0]) ? 'keyword' : '', word[0]);
                index += word[0].length;
                continue;
            }
            let end = index + 1;
            while (end < code.length && !/[\n\w$"'`#/({]/.test(code[end])) end++;
            push('', code.slice(index, end));
            index = end;
        }
    }
    // Lines of tokens, merging plain neighbours.
    const lines: Token[][] = [[]];
    for (const token of tokens) {
        const parts = token.text.split('\n');
        parts.forEach((part, partIndex) => {
            if (partIndex > 0) lines.push([]);
            if (!part) return;
            const current = lines[lines.length - 1];
            const last = current[current.length - 1];
            if (last && last.type === token.type) last.text += part;
            else current.push({ type: token.type, text: part });
        });
    }
    if (lines.length > 1 && !lines[lines.length - 1].length && code.endsWith('\n')) lines.pop();
    return lines;
}

export const languages = Object.keys(syntax);
