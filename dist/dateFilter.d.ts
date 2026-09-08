export type DateRangePreset = '24h' | '7d' | '30d';
export declare function parseFechaApertura(value: string): Date | null;
export declare function isWithinDateRange(date: Date | null, preset: DateRangePreset | undefined, now: Date): boolean;
//# sourceMappingURL=dateFilter.d.ts.map