export const env = {
  serviceName: process.env.OTEL_SERVICE_NAME || 'k9-robot',
  serviceVersion: process.env.SERVICE_VERSION || '0.0.1',
  environment: process.env.NODE_ENV || 'development',

  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',

  logLevel: process.env.LOG_LEVEL || 'warn',

  // sampling: 1.0 = 100%, 0.1 = 10%
  // production: 0.01-0.1, development: 0.2-1.0
  traceSampleRate: Number(process.env.OTEL_TRACES_SAMPLER_ARG ||
    (process.env.NODE_ENV === 'production' ? 0.1 : 0.5)),
};