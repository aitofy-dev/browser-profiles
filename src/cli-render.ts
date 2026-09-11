// ============================================================================
// @aitofy/browser-profiles - Pure CLI surface derived from the command registry
// ============================================================================
// Zod schemas are the single source of flags and help. Nothing here touches
// the filesystem, commander or process state, so it is directly unit-testable.

import { z } from 'zod';
import { cliPathFor } from './commands/registry';
import type { AnyCommandDef, CommandCli } from './commands/registry';

export type CliOptionKind = 'string' | 'number' | 'boolean' | 'array';

export interface CliOption {
    /** Input key this option feeds, e.g. 'startUrl'. */
    key: string;
    /** Commander flag spec, e.g. '--start-url <value>'. */
    flags: string;
    description: string;
    kind: CliOptionKind;
    required: boolean;
    /** True for '--no-x', emitted when the schema defaults the field to true. */
    negated: boolean;
    /** Extra flag that sends null for a nullable field, e.g. '--no-proxy'. */
    clearFlag?: string;
    /** Enum members, listed in the help text. */
    choices?: string[];
}

export interface CliPositional {
    key: string;
    /** Commander argument spec, e.g. '<idOrName>' or '[name]'. */
    arg: string;
    description: string;
}

/** An `example` the command file may declare; optional so defs stay valid without it. */
interface CliWithExample extends CommandCli {
    example?: string;
}

export function exampleFor(def: AnyCommandDef): string | undefined {
    const example = (def.cli as CliWithExample | undefined)?.example;
    return typeof example === 'string' && example.length > 0 ? example : undefined;
}

/** Repeatable array flag: `--tags a --tags b` or `--tags a,b`. */
export function collectList(value: string, previous: string[] | undefined): string[] {
    return [
        ...(previous ?? []),
        ...value.split(',').map((item) => item.trim()).filter((item) => item.length > 0),
    ];
}

/** Positionals plus the flags the schema declared, and nothing else. */
export function mergeInput(
    positionalKeys: readonly string[],
    values: readonly unknown[],
    options: Record<string, unknown>,
    specs: readonly CliOption[]
): Record<string, unknown> {
    const input: Record<string, unknown> = {};
    positionalKeys.forEach((key, index) => {
        if (values[index] !== undefined) input[key] = values[index];
    });
    for (const spec of specs) {
        const value = options[spec.key];
        if (value === undefined) continue;
        // commander reports '--no-proxy' as false; the schema wants an explicit null.
        input[spec.key] = spec.clearFlag && value === false ? null : value;
    }
    return input;
}

/** The profile or temporary session a keepAlive command started. */
export function startedProfileId(output: unknown): string | undefined {
    if (typeof output !== 'object' || output === null) return undefined;
    const { profileId } = output as { profileId?: unknown };
    return typeof profileId === 'string' ? profileId : undefined;
}

function kebabCase(key: string): string {
    return key.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`);
}

interface Unwrapped {
    inner: z.ZodType;
    optional: boolean;
    nullable: boolean;
    defaultValue: unknown;
}

/** Peel optional/nullable/default wrappers, which stack in any order. */
function unwrapField(field: z.ZodType): Unwrapped {
    let inner = field;
    let optional = false;
    let nullable = false;
    let defaultValue: unknown;

    for (;;) {
        if (inner instanceof z.ZodOptional) {
            optional = true;
            inner = inner.unwrap() as z.ZodType;
        } else if (inner instanceof z.ZodNullable) {
            nullable = true;
            inner = inner.unwrap() as z.ZodType;
        } else if (inner instanceof z.ZodDefault) {
            optional = true;
            defaultValue = inner.def.defaultValue;
            inner = inner.unwrap() as z.ZodType;
        } else {
            return { inner, optional, nullable, defaultValue };
        }
    }
}

function choicesOf(inner: z.ZodType): string[] | undefined {
    if (!(inner instanceof z.ZodEnum)) return undefined;
    return inner.options.map((value) => String(value));
}

function kindOf(inner: z.ZodType): CliOptionKind {
    if (inner instanceof z.ZodBoolean) return 'boolean';
    if (inner instanceof z.ZodNumber) return 'number';
    if (inner instanceof z.ZodArray) return 'array';
    return 'string';
}

function valuePlaceholder(kind: CliOptionKind): string {
    if (kind === 'number') return ' <number>';
    if (kind === 'array') return ' <value...>';
    return ' <value>';
}

function helpFor(field: z.ZodType, kind: CliOptionKind, choices: string[] | undefined): string {
    const parts = [field.description ?? ''];
    if (choices) parts.push(`One of: ${choices.join(', ')}.`);
    if (kind === 'array') parts.push('Repeat the flag or pass a comma-separated list.');
    return parts.filter((part) => part.length > 0).join(' ');
}

function toOption(key: string, field: z.ZodType): CliOption {
    const { inner, optional, nullable, defaultValue } = unwrapField(field);
    const kind = kindOf(inner);
    const choices = choicesOf(inner);
    const negated = kind === 'boolean' && defaultValue === true;
    const name = kebabCase(key);
    // A nullable field can only be cleared from the CLI through a second flag.
    const clearFlag = nullable && kind !== 'boolean' ? `--no-${name}` : undefined;

    return {
        key,
        flags: kind === 'boolean'
            ? (negated ? `--no-${name}` : `--${name}`)
            : `--${name}${valuePlaceholder(kind)}`,
        description: helpFor(field, kind, choices),
        kind,
        required: !optional,
        negated,
        ...(clearFlag ? { clearFlag } : {}),
        ...(choices ? { choices } : {}),
    };
}

function shapeOf(schema: z.ZodObject<z.ZodRawShape>): Record<string, z.ZodType> {
    return schema.shape as Record<string, z.ZodType>;
}

/** Every input field that is not a positional becomes one `--flag`. */
export function optionsFromSchema(
    schema: z.ZodObject<z.ZodRawShape>,
    positionalKeys: readonly string[] = []
): CliOption[] {
    return Object.entries(shapeOf(schema))
        .filter(([key]) => !positionalKeys.includes(key))
        .map(([key, field]) => toOption(key, field));
}

/** Positional keys, in the order the command declared them. */
export function positionalsFromSchema(
    schema: z.ZodObject<z.ZodRawShape>,
    positionalKeys: readonly string[] = []
): CliPositional[] {
    const shape = shapeOf(schema);
    return positionalKeys
        .filter((key) => shape[key] !== undefined)
        .map((key) => {
            const field = shape[key];
            const { optional } = unwrapField(field);
            return {
                key,
                arg: optional ? `[${key}]` : `<${key}>`,
                description: field.description ?? '',
            };
        });
}

function firstSentence(text: string): string {
    const end = text.search(/\.\s/);
    return end === -1 ? text : text.slice(0, end + 1);
}

const HELP_COLUMN = 34;

function helpLine(def: AnyCommandDef): string[] {
    const args = positionalsFromSchema(def.input, def.cli?.positional ?? []).map((one) => one.arg);
    const usage = [...cliPathFor(def), ...args].join(' ');
    const aliases = def.cli?.aliases ?? [];
    const tail = aliases.length > 0 ? `  (aliases: ${aliases.join(', ')})` : '';
    const lines = [`    ${usage.padEnd(HELP_COLUMN)}${firstSentence(def.description)}${tail}`];

    const example = exampleFor(def);
    if (example) lines.push(`    ${' '.repeat(HELP_COLUMN)}example: ${example}`);
    return lines;
}

// `mcp` is not a registry command: it starts the server that exposes all of them.
const MCP_HELP = [
    '',
    '  mcp',
    `    ${'mcp'.padEnd(HELP_COLUMN)}Serve every command as MCP tools over stdio.`,
    '',
    'Run "browser-profiles <command> --help" for the flags of one command.',
    '',
];

/** The grouped command list appended to the root `--help`. */
export function renderCommandsHelp(defs: readonly AnyCommandDef[]): string {
    const groups = new Map<string, AnyCommandDef[]>();
    for (const def of defs) {
        const group = cliPathFor(def)[0];
        const existing = groups.get(group);
        if (existing) existing.push(def);
        else groups.set(group, [def]);
    }

    const lines = ['', 'Commands:'];
    for (const [group, members] of groups) {
        lines.push('', `  ${group}`);
        for (const def of members) lines.push(...helpLine(def));
    }
    lines.push(...MCP_HELP);
    return lines.join('\n');
}
