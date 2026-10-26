export type PassageInput = string | number | null | undefined | false | PassageInput[]

export function passageText(input: PassageInput): string
export function passageId(text: string, prefix?: string): string
export function speakDigits(value: string | number): string
export function estimateSeconds(text: PassageInput, options?: { wordsPerMinute?: number; rate?: number }): number
export function formatTime(seconds: number): string
