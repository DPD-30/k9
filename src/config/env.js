export const env = {
  serviceName: process.env.OTEL_SERVICE_NAME || 'my-node-service',
  serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
  environment: process.env.NODE_ENV || 'development',

  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',

  logLevel: process.env.LOG_LEVEL || 'info',

  // sampling: 1.0 = 100%, 0.1 = 10%
  traceSampleRate: Number(process.env.OTEL_TRACES_SAMPLER_ARG || 0.2),
};