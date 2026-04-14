import {logger} from '../observability/logger.js';

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-node';
import { resourceFromAttributes } from '@opentelemetry/resources';

import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { env } from '../config/env.js';


// ---- Resource (service identity) ----
const resource = resourceFromAttributes({
  [SEMRESATTRS_SERVICE_NAME]: env.serviceName,
  [SEMRESATTRS_SERVICE_VERSION]: env.serviceVersion,
  'deployment.environment': env.environment,
});

// ---- Exporters (HTTP -> local collector) ----
const traceExporter = new OTLPTraceExporter({
  url: `${env.otlpEndpoint}/v1/traces`,
});

const metricExporter = new OTLPMetricExporter({
  url: `${env.otlpEndpoint}/v1/metrics`,
});

// ---- Sampler (parent-based with configurable rate) ----
// ParentBased: always sample if parent is sampled, otherwise use ratio sampler
const sampler = new ParentBasedSampler({
  root: new TraceIdRatioBasedSampler(env.traceSampleRate),
});

// ---- SDK ----
export const sdk = new NodeSDK({
  resource,
  traceExporter,
  metricExporter,
  sampler,
  instrumentations: [getNodeAutoInstrumentations()],
});

// ---- Start ----
export async function startTelemetry() {
  await sdk.start();
  logger.info('OpenTelemetry started');
}

// ---- Shutdown ----
export async function shutdownTelemetry() {
  await sdk.shutdown();
  logger.info('OpenTelemetry stopped');
}