import {
  FunctionConfiguration,
  InvokeCommandOutput,
} from '@aws-sdk/client-lambda';

export const parseLog = (
  invokeResult: InvokeCommandOutput
): [duration: number, init: number] => {
  const log = Buffer.from(invokeResult.LogResult || '', 'base64').toString();
  return [
    parseFloat(log.split('\tDuration: ')[1].split(' ms')[0]),
    parseFloat(log.split('Init Duration: ')[1] || '0'),
  ];
};

export const getStats = (
  durations: number[],
  inits: number[],
  config: FunctionConfiguration = {}
) => {
  const coldStarts = inits.filter((init) => init !== 0);
  const {
    Architectures,
    CodeSize,
    Description,
    Environment,
    FunctionName,
    Layers,
    MemorySize,
    Runtime,
  } = config;
  return {
    Architectures,
    CodeSize,
    ColdStarts: coldStarts.length
      ? {
          coldStartPercent: `${(coldStarts.length / inits.length) * 100}%`,
          mean: mean(coldStarts),
          median: median(coldStarts),
          p90: p90(coldStarts),
        }
      : { coldStartPercent: '0%' },
    Description,
    Durations: {
      mean: mean(durations),
      median: median(durations),
      p90: p90(durations),
    },
    FunctionName,
    Layers,
    MemorySize,
    Runtime,
    SourceMapsEnabled: !!Environment?.Variables?.NODE_OPTIONS.includes(
      '--enable-source-maps'
    ),
  };
};

// Stolen from SO https://stackoverflow.com/a/55297611/1487358
const asc = (arr: number[]) => arr.sort((a, b) => a - b);

const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

const mean = (arr: number[]) => twoDecimals(sum(arr) / arr.length);

const quantile = (arr: number[], q: number) => {
  const sorted = asc(arr);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return twoDecimals(sorted[base] + rest * (sorted[base + 1] - sorted[base]));
  } else {
    return sorted[base];
  }
};

const median = (arr: number[]) => quantile(arr, 0.5);

const p90 = (arr: number[]) => quantile(arr, 0.9);

const twoDecimals = (num: number) =>
  Math.round((num + Number.EPSILON) * 100) / 100;
